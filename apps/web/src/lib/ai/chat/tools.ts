/**
 * Function-calling tool catalog for the AI Assistant.
 *
 * Two classes of tools:
 *  - Read-only (`mutates: false`): auto-execute when the model emits them;
 *    the result is appended to history and feeds the next inference turn.
 *  - Mutating (`mutates: true`): collected into a per-tool batch and rendered
 *    as a confirmation card. User reviews and approves before execution.
 *
 * Per design decision D2: ALL DB mutations require user confirmation.
 */

import type { DataRepository } from '@/lib/repository/types';
import { searchDictionary } from '@/lib/dictionary/jisho';
import { getAttachment, blobToDataUrl } from './attachments';
import { extractViaBridge } from '@/lib/ai/native-bridge-adapter';
import { shortenId } from './id-shortener';
import type { Word } from '@/types/word';
import type { Wordbook } from '@/types/wordbook';
import type { AiToolDef, ChatScope } from '@/types/chat';

export interface ChatIdTable {
  word: Map<string, string>;     // short id (8-char) → full UUID
  wordbook: Map<string, string>;
}

export interface ToolContext {
  repo: DataRepository;
  locale: string;
  /** Short-id → full-id mappings the model has seen so far this session.
   *  Populated by tool executes as they produce entities. Mutating tools
   *  that take a wordId / wordbookId resolve through this table when the
   *  arg is shorter than 36 chars. */
  idTable: ChatIdTable;
}

export function emptyIdTable(): ChatIdTable {
  return { word: new Map(), wordbook: new Map() };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** True for any tool that writes to the Repository — gated behind confirm. */
  mutates: boolean;
  /** Execute the tool. Implementations may throw; caller surfaces errors as tool_result. */
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  /** Sentence-case label for the confirm card. Always returns Korean — the
   *  caller wraps with the i18n triad if needed. */
  describeAction: (args: Record<string, unknown>) => string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string') throw new Error(`Argument '${key}' must be a string`);
  return v;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new Error(`Argument '${key}' must be a string when present`);
  return v;
}

function bool(args: Record<string, unknown>, key: string): boolean {
  const v = args[key];
  if (typeof v !== 'boolean') throw new Error(`Argument '${key}' must be a boolean`);
  return v;
}

function optInt(args: Record<string, unknown>, key: string, max?: number): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const n = Math.floor(v);
  return max !== undefined ? Math.min(n, max) : n;
}

function stripWordForToolResult(word: Word) {
  return {
    id: shortenId(word.id),
    term: word.term,
    reading: word.reading,
    meaning: word.meaning,
    jlptLevel: word.jlptLevel,
  };
}

function stripWordbookForToolResult(wb: Wordbook) {
  return {
    id: shortenId(wb.id),
    name: wb.name,
    description: wb.description,
  };
}

/** Resolve a wordId / wordbookId argument. Pass through full UUIDs; look up
 *  short prefixes in the session idTable. Throws if the model invented a
 *  prefix not seen in any tool result this session. */
function resolveId(
  raw: string,
  table: Map<string, string>,
  kind: 'wordId' | 'wordbookId',
): string {
  // Treat as full UUID if it has the canonical 36-char dashed shape OR
  // the 32-char dashless shape. Anything else is either a short prefix
  // (look up) or malformed (caller will surface the repo-level error).
  const looksFull =
    (raw.length === 36 && raw.includes('-')) || raw.length === 32;
  if (looksFull) return raw;
  const full = table.get(raw);
  if (!full) {
    throw new Error(
      `Unknown ${kind} '${raw}'. Use search_words first or paste the full id.`,
    );
  }
  return full;
}

/** Write a (shortId, fullId) pair into the session idTable. Detects the
 *  rare case where two distinct UUIDs share their 8-char prefix in one
 *  session and refuses to overwrite — the first one wins. Logs a warning
 *  so a stealth data-loss bug doesn't sit invisible. */
function recordId(
  table: Map<string, string>,
  fullId: string,
  kind: 'word' | 'wordbook',
): void {
  const short = shortenId(fullId);
  const existing = table.get(short);
  if (existing && existing !== fullId) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[chat] idTable ${kind} short-id collision: '${short}' already maps to ` +
        `'${existing}', refusing to remap to '${fullId}'. ` +
        `The model should reference '${existing}' by full id to disambiguate.`,
      );
    }
    return; // first writer wins
  }
  table.set(short, fullId);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const TOOLS: Record<string, ToolDefinition> = {
  search_words: {
    name: 'search_words',
    description: "Search the user's vocab by term/reading/meaning (≤20 matches).",
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', maximum: 20 },
      },
    },
    mutates: false,
    execute: async (args, { repo, idTable }) => {
      const limit = optInt(args, 'limit', 20) ?? 10;
      const results = await repo.words.search(str(args, 'query'));
      const sliced = results.slice(0, limit);
      for (const w of sliced) recordId(idTable.word, w.id, 'word');
      return sliced.map(stripWordForToolResult);
    },
    describeAction: (args) => `단어 검색: ${args.query ?? ''}`,
  },

  extract_words_from_image: {
    name: 'extract_words_from_image',
    description: "Extract Japanese words from an image attached this turn (≤50).",
    parameters: {
      type: 'object',
      required: ['attachmentId'],
      properties: {
        attachmentId: { type: 'string' },
      },
    },
    mutates: false,
    execute: async (args, { locale }) => {
      const attachmentId = str(args, 'attachmentId');
      const blob = await getAttachment(attachmentId);
      if (!blob) {
        throw new Error(`Attachment ${attachmentId} not found in local storage.`);
      }
      const dataUrl = await blobToDataUrl(blob);
      const words = await extractViaBridge(dataUrl, locale);
      return {
        count: words.length,
        words: words.slice(0, 50).map((w) => ({
          term: w.term,
          reading: w.reading,
          meaning: w.meaning,
          jlptLevel: w.jlptLevel,
        })),
      };
    },
    describeAction: () => `이미지에서 단어 추출`,
  },

  add_word: {
    name: 'add_word',
    description:
      "Add a Japanese word to the user's list. Requires an existing dictionary entry — search via Jisho first or ask the user for a known dictionary form.",
    parameters: {
      type: 'object',
      required: ['term', 'reading', 'meaning'],
      properties: {
        term: { type: 'string', maxLength: 10 },
        reading: { type: 'string' },
        meaning: { type: 'string' },
        jlptLevel: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
        priority: { type: 'integer', minimum: 0, maximum: 5 },
      },
    },
    mutates: true,
    execute: async (args, { repo, locale, idTable }) => {
      const term = str(args, 'term');
      const reading = str(args, 'reading');
      // Resolve dictionaryEntryId via jisho lookup (the WordRepository contract
      // requires it). Falls back to creating from term+reading if no match —
      // the SupabaseRepository internally upserts a dict entry when none is
      // found.
      let dictionaryEntryId = '';
      try {
        const entries = await searchDictionary(term, locale);
        const exact = entries.find((e) =>
          e.japanese.some(
            (j) =>
              (j.word ?? j.reading) === term &&
              (!j.reading || j.reading === reading || j.reading === ''),
          ),
        );
        const pick = exact ?? entries[0];
        dictionaryEntryId = pick?.id ?? '';
      } catch {
        // Network / RPC failure — fall through to throw below.
      }
      if (!dictionaryEntryId) {
        throw new Error(
          `No dictionary entry found for term '${term}'. The word cannot be added without a matching dictionary entry. The user may need to provide a valid dictionary form.`,
        );
      }
      const created = await repo.words.create({
        dictionaryEntryId,
        term,
        reading,
        meaning: str(args, 'meaning'),
        notes: null,
        tags: [],
        jlptLevel: optInt(args, 'jlptLevel') ?? null,
      });
      const priority = optInt(args, 'priority');
      if (priority !== undefined) {
        await repo.words.setPriority(created.id, priority);
      }
      recordId(idTable.word, created.id, 'word');
      return stripWordForToolResult(created);
    },
    describeAction: (args) => `단어 「${args.term ?? ''}」 추가`,
  },

  set_mastered: {
    name: 'set_mastered',
    description: 'Toggle word mastered status (true=mastered, false=active).',
    parameters: {
      type: 'object',
      required: ['wordId', 'mastered'],
      properties: {
        wordId: { type: 'string' },
        mastered: { type: 'boolean' },
      },
    },
    mutates: true,
    execute: async (args, { repo, idTable }) => {
      const wordId = resolveId(str(args, 'wordId'), idTable.word, 'wordId');
      const word = await repo.words.setMastered(wordId, bool(args, 'mastered'));
      return { id: shortenId(word.id), mastered: bool(args, 'mastered') };
    },
    describeAction: (args) => (args.mastered ? '암기완료로 표시' : '암기 해제'),
  },

  add_word_to_wordbook: {
    name: 'add_word_to_wordbook',
    description: 'Add an existing word to a wordbook.',
    parameters: {
      type: 'object',
      required: ['wordId', 'wordbookId'],
      properties: {
        wordId: { type: 'string' },
        wordbookId: { type: 'string' },
      },
    },
    mutates: true,
    execute: async (args, { repo, idTable }) => {
      const wordId = resolveId(str(args, 'wordId'), idTable.word, 'wordId');
      const wordbookId = resolveId(str(args, 'wordbookId'), idTable.wordbook, 'wordbookId');
      await repo.wordbooks.addWord(wordbookId, wordId);
      return { ok: true, wordId: shortenId(wordId), wordbookId: shortenId(wordbookId) };
    },
    describeAction: () => '단어장에 단어 추가',
  },

  remove_word_from_wordbook: {
    name: 'remove_word_from_wordbook',
    description: 'Remove a word from a wordbook (keeps the word).',
    parameters: {
      type: 'object',
      required: ['wordId', 'wordbookId'],
      properties: {
        wordId: { type: 'string' },
        wordbookId: { type: 'string' },
      },
    },
    mutates: true,
    execute: async (args, { repo, idTable }) => {
      const wordId = resolveId(str(args, 'wordId'), idTable.word, 'wordId');
      const wordbookId = resolveId(str(args, 'wordbookId'), idTable.wordbook, 'wordbookId');
      await repo.wordbooks.removeWord(wordbookId, wordId);
      return { ok: true, wordId: shortenId(wordId), wordbookId: shortenId(wordbookId) };
    },
    describeAction: () => '단어장에서 단어 제거',
  },

  create_wordbook: {
    name: 'create_wordbook',
    description: 'Create a new wordbook.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', maxLength: 50 },
        description: { type: 'string', maxLength: 200 },
      },
    },
    mutates: true,
    execute: async (args, { repo, idTable }) => {
      const wb = await repo.wordbooks.create({
        name: str(args, 'name'),
        description: optStr(args, 'description') ?? null,
      });
      recordId(idTable.wordbook, wb.id, 'wordbook');
      return stripWordbookForToolResult(wb);
    },
    describeAction: (args) => `단어장 「${args.name ?? ''}」 생성`,
  },

  edit_word: {
    name: 'edit_word',
    description: "Edit a word's reading/meaning/JLPT/priority (not the kanji term).",
    parameters: {
      type: 'object',
      required: ['wordId'],
      properties: {
        wordId: { type: 'string' },
        reading: { type: 'string' },
        meaning: { type: 'string' },
        jlptLevel: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
        priority: { type: 'integer', minimum: 0, maximum: 5 },
      },
    },
    mutates: true,
    execute: async (args, { repo, idTable }) => {
      const wordId = resolveId(str(args, 'wordId'), idTable.word, 'wordId');
      const updated = await repo.words.update(wordId, {
        reading: optStr(args, 'reading'),
        meaning: optStr(args, 'meaning'),
        jlptLevel: optInt(args, 'jlptLevel'),
      });
      recordId(idTable.word, updated.id, 'word');
      const priority = optInt(args, 'priority');
      if (priority !== undefined) {
        await repo.words.setPriority(updated.id, priority);
      }
      return stripWordForToolResult(updated);
    },
    describeAction: () => '단어 편집',
  },

  edit_wordbook: {
    name: 'edit_wordbook',
    description: 'Rename or change a wordbook description.',
    parameters: {
      type: 'object',
      required: ['wordbookId'],
      properties: {
        wordbookId: { type: 'string' },
        name: { type: 'string', maxLength: 50 },
        description: { type: 'string', maxLength: 200 },
      },
    },
    mutates: true,
    execute: async (args, { repo, idTable }) => {
      const wordbookId = resolveId(str(args, 'wordbookId'), idTable.wordbook, 'wordbookId');
      const wb = await repo.wordbooks.update(wordbookId, {
        name: optStr(args, 'name'),
        description: optStr(args, 'description'),
      });
      recordId(idTable.wordbook, wb.id, 'wordbook');
      return stripWordbookForToolResult(wb);
    },
    describeAction: () => '단어장 편집',
  },

  generate_example_sentence: {
    name: 'generate_example_sentence',
    description:
      "Save ONE Japanese example sentence for a word (call multiple times for multiple sentences, separate tool_call tags). Include reading + translation.",
    parameters: {
      type: 'object',
      required: ['wordId', 'sentenceJa'],
      properties: {
        wordId: { type: 'string' },
        sentenceJa: { type: 'string' },
        sentenceReading: { type: 'string' },
        sentenceMeaning: { type: 'string' },
      },
    },
    mutates: true,
    execute: async (args, { repo, idTable }) => {
      const wordId = resolveId(str(args, 'wordId'), idTable.word, 'wordId');
      const created = await repo.words.addExample(wordId, {
        sentenceJa: str(args, 'sentenceJa'),
        sentenceReading: optStr(args, 'sentenceReading'),
        sentenceMeaning: optStr(args, 'sentenceMeaning'),
        source: 'ai_generated',
      });
      return {
        sentenceJa: created.sentenceJa,
      };
    },
    describeAction: (args) =>
      `예문 추가: 「${typeof args.sentenceJa === 'string' && args.sentenceJa.length > 40 ? args.sentenceJa.slice(0, 40) + '…' : args.sentenceJa ?? ''}」`,
  },

  delete_word: {
    name: 'delete_word',
    description: 'Delete a word permanently.',
    parameters: {
      type: 'object',
      required: ['wordId'],
      properties: { wordId: { type: 'string' } },
    },
    mutates: true,
    execute: async (args, { repo, idTable }) => {
      const wordId = resolveId(str(args, 'wordId'), idTable.word, 'wordId');
      await repo.words.delete(wordId);
      return { ok: true, wordId: shortenId(wordId) };
    },
    describeAction: () => '단어 삭제 (취소 불가)',
  },

  delete_wordbook: {
    name: 'delete_wordbook',
    description: 'Delete a wordbook (words preserved).',
    parameters: {
      type: 'object',
      required: ['wordbookId'],
      properties: { wordbookId: { type: 'string' } },
    },
    mutates: true,
    execute: async (args, { repo, idTable }) => {
      const wordbookId = resolveId(str(args, 'wordbookId'), idTable.wordbook, 'wordbookId');
      await repo.wordbooks.delete(wordbookId);
      return { ok: true, wordbookId: shortenId(wordbookId) };
    },
    describeAction: () => '단어장 삭제 (취소 불가)',
  },
};

// ---------------------------------------------------------------------------
// Scope allowlist (declared after TOOLS so `general` can derive from its keys)
// ---------------------------------------------------------------------------

export const SCOPE_TOOL_ALLOWLIST: Record<ChatScope['kind'], readonly string[]> = {
  /** All tools — derived at module init so newly added tools are included automatically. */
  general: Object.keys(TOOLS),
  word: [
    'search_words',
    'set_mastered',
    'edit_word',
    'add_word_to_wordbook',
    'remove_word_from_wordbook',
    'generate_example_sentence',
  ],
  wordbook: [
    'search_words',
    'add_word_to_wordbook',
    'remove_word_from_wordbook',
    'edit_wordbook',
  ],
  quiz: [
    'search_words',
    'set_mastered',
    'generate_example_sentence',
  ],
};

/** Tool definitions in the wire format the bridge expects (no execute fn).
 *  Filtered to the tools that are useful in the given scope. */
export function getToolDefsForBridge(scope: ChatScope): AiToolDef[] {
  const allowed = new Set(SCOPE_TOOL_ALLOWLIST[scope.kind]);
  return Object.values(TOOLS)
    .filter((t) => allowed.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
}

/** Lookup a tool by name, or null if the model invented one. */
export function getTool(name: string): ToolDefinition | null {
  return TOOLS[name] ?? null;
}
