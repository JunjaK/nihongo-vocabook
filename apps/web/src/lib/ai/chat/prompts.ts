/**
 * System prompts and scope-specific context builders for the AI Assistant.
 *
 * The base prompt instructs the model on tool-call format and behavior. Each
 * scope appends a context block describing the entity the user is currently
 * working with. See `_docs/ai-assistant-and-footer-redesign.md` Section
 * "System Prompts" for the full design.
 */

import type { DataRepository } from '@/lib/repository/types';
import type { ChatScope } from '@/types/chat';
import type { Word } from '@/types/word';
import type { WordbookWithCount } from '@/types/wordbook';
import { shortenId } from './id-shortener';

const MAX_WORDBOOK_SAMPLE = 20;

export function baseSystemPrompt(locale: string): string {
  const isKo = locale === 'ko';
  const replyLine = isKo
    ? 'Reply in Korean.'
    : 'Reply in English.';
  const exampleLine = isKo
    ? 'Example — User: "桜 뜻이 뭐야?"  You: "桜(さくら)는 「벚꽃」을 뜻해요."'
    : 'Example — User: "What does 桜 mean?"  You: "桜(さくら) means cherry blossom."';
  const grammarExample = isKo
    ? 'Example — User: "이거 문법 설명해줘"  You: 자연어 설명만, tool 호출 없이.'
    : 'Example — User: "Explain the grammar."  You: Plain-text explanation, no tool call.';

  return [
    "You're a Japanese vocabulary tutor for a Korean learner.",
    `${replyLine} ALWAYS write Japanese terms as 漢字(かな) — e.g. 桜(さくら), not just 桜 or さくら.`,
    'Use 「」 for emphasized Korean quotes, never " or \' (JSON-safe).',
    '',
    'Tool rules:',
    '- Never invent word/wordbook IDs. Use search_words or ask the user.',
    '- Never call delete_* tools unless the user explicitly says "delete" or "삭제".',
    '- For meaning/explanation/grammar/usage questions, answer in plain text. No tool call.',
    '',
    exampleLine,
    grammarExample,
  ].join('\n');
}

function wordContextBlock(word: Word, wordbooks: WordbookWithCount[]): string {
  const wbNames = wordbooks.length > 0 ? wordbooks.map((w) => w.name).join(', ') : '(none)';
  return [
    '',
    'WORD CONTEXT — the user is viewing this specific word.',
    '',
    'CURRENT WORD:',
    `  id: ${shortenId(word.id)}`,
    `  term: ${word.term} (${word.reading}) — ${word.meaning}`,
    `  jlpt: ${word.jlptLevel ?? 'unknown'}, mastered: ${word.mastered ? 'true' : 'false'}`,
    `  wordbooks: [${wbNames}]`,
    '',
    'Your focus is this word and nothing else.',
    'Suggest on request: 유의어, 대조어, 추가 예문, 사용 맥락, 어원, 비슷한 한자 단어.',
    '',
    'When the user explicitly asks to modify (edit, add to wordbook, save example, mark mastered),',
    'use the tool. Otherwise answer in natural language only.',
  ].join('\n');
}

function wordbookContextBlock(
  wb: WordbookWithCount,
  sample: Word[],
): string {
  const sampleLines = sample
    .slice(0, MAX_WORDBOOK_SAMPLE)
    .map((w) => `    ${shortenId(w.id)}: ${w.term} (${w.reading}) — ${w.meaning}`)
    .join('\n');
  const shown = Math.min(sample.length, MAX_WORDBOOK_SAMPLE);
  return [
    '',
    'WORDBOOK CONTEXT — the user is managing this wordbook.',
    '',
    'CURRENT WORDBOOK:',
    `  id: ${shortenId(wb.id)}`,
    `  name: ${wb.name}`,
    `  totalWords: ${wb.wordCount}`,
    `  sample (first ${shown} of ${wb.wordCount}):`,
    sampleLines || '    (no words)',
    '',
    'You help curate this wordbook: add/remove words, rename, suggest related words.',
    'If the user asks "이 단어장에 X 있어?", call search_words (its results auto-scope to the user\'s vocab).',
    `Sample above shows ${shown} of ${wb.wordCount} — call search_words for words not visible.`,
  ].join('\n');
}

function quizContextBlock(
  word: Word | null,
  lastRating: number | undefined,
): string {
  if (!word) {
    return [
      '',
      'QUIZ CONTEXT — no card visible (the session may have ended).',
    ].join('\n');
  }
  const ratingMap: Record<number, string> = {
    1: 'again',
    2: 'hard',
    3: 'good',
    4: 'easy',
  };
  const rating =
    lastRating !== undefined ? (ratingMap[lastRating] ?? `unknown(${lastRating})`) : 'unknown';
  return [
    '',
    `QUIZ CONTEXT — the user just rated this card as "${rating}" and is asking for help.`,
    '',
    'CURRENT CARD:',
    `  id: ${shortenId(word.id)}`,
    `  term: ${word.term} (${word.reading}) — ${word.meaning}`,
    `  jlpt: ${word.jlptLevel ?? 'unknown'}`,
    '',
    'Your job: explain this specific word with focus on what helps retention.',
    'Suggest: 유의어 (synonyms), 대조어 (antonyms/contrast), 추가 예문 (more examples), 어원 or 한자 분해 (if useful).',
    '',
    'Tone by rating:',
    '- "again" (어려워함) → 짧고 단순한 설명, 1~2개 예문, 핵심 의미만',
    '- "hard"           → 짧은 설명 + 비슷한 단어 1개, 예문 2개',
    '- "good"           → 표준 설명 + 유의/대조어, 예문 2~3개',
    '- "easy"           → nuance, 비슷한 표현 비교, 예문 3개',
    '',
    'NO tool calls in this scope — answer entirely in natural language.',
    'Exception: if the user explicitly asks "이 예문 저장해줘" / "마스터드 표시" / "비슷한 거 검색", use the corresponding tool.',
  ].join('\n');
}

/**
 * Build the full system prompt for a given scope. Async because some scopes
 * load entity data from the Repository.
 */
export async function buildSystemPrompt(
  scope: ChatScope,
  repo: DataRepository,
  locale: string,
): Promise<string> {
  const base = baseSystemPrompt(locale);
  switch (scope.kind) {
    case 'general':
      return base;

    case 'word': {
      const word = await repo.words.getById(scope.wordId);
      if (!word) return base;
      const wordbooks = await repo.wordbooks.getWordbooksForWord(scope.wordId);
      const withCount = wordbooks.map(
        (wb) => ({ ...wb, wordCount: 0, importCount: 0, masteredCount: 0 } as WordbookWithCount),
      );
      return base + wordContextBlock(word, withCount);
    }

    case 'wordbook': {
      const wbList = await repo.wordbooks.getAll();
      const wb = wbList.find((w) => w.id === scope.wordbookId);
      if (!wb) return base;
      const paginated = await repo.wordbooks.getWordsPaginated(scope.wordbookId, {
        sort: 'priority',
        limit: MAX_WORDBOOK_SAMPLE,
        offset: 0,
      });
      return base + wordbookContextBlock(wb, paginated.words);
    }

    case 'quiz': {
      const word = scope.currentWordId
        ? await repo.words.getById(scope.currentWordId)
        : null;
      return base + quizContextBlock(word, scope.lastRating);
    }
  }
}

// ---------------------------------------------------------------------------
// Token budgeting (rough estimator — char/4 for text, +256 per image block)
// ---------------------------------------------------------------------------

const DEFAULT_KV_CACHE = 2048;
const IMAGE_TOKEN_COST = 256;
const AUDIO_TOKEN_COST = 384;

export interface Budget {
  total: number;
  reservedForOutput: number;
  reservedForNextUser: number;
}

/**
 * Pick reasonable reserves for the given KV cache ceiling. Bigger caches
 * support richer explanations without truncating mid-sentence, so the
 * output reserve scales up; the next-user reserve grows modestly for
 * multi-turn quiz Q&A.
 */
export function getBudget(kvCache?: number): Budget {
  const total = kvCache && kvCache > 0 ? kvCache : DEFAULT_KV_CACHE;
  const reservedForOutput =
    total >= 16384 ? 2048 :
    total >= 8192  ? 1024 :
    total >= 4096  ? 768  :
                     600;
  const reservedForNextUser = total >= 8192 ? 400 : 200;
  return { total, reservedForOutput, reservedForNextUser };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface MessageLike {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; attachmentId?: string; source?: string }
    | { type: 'audio'; attachmentId?: string; source?: string; mimeType?: string }
    | { type: 'tool_result'; result: unknown }
  >;
}

export function estimateMessageTokens(msg: MessageLike): number {
  let total = 4; // role tags overhead
  for (const block of msg.content) {
    if (block.type === 'text') total += estimateTokens(block.text);
    else if (block.type === 'image') total += IMAGE_TOKEN_COST;
    else if (block.type === 'audio') total += AUDIO_TOKEN_COST;
    else if (block.type === 'tool_result') total += estimateTokens(JSON.stringify(block.result ?? {}));
  }
  return total;
}

/**
 * Group consecutive messages into turn groups. A new group starts on each
 * `user` message; everything until the next `user` (assistant replies,
 * tool results, follow-up assistant chunks) belongs to that group.
 */
function groupTurns<T extends MessageLike>(messages: T[]): T[][] {
  const groups: T[][] = [];
  for (const m of messages) {
    if (m.role === 'user' || groups.length === 0) {
      groups.push([m]);
    } else {
      groups[groups.length - 1].push(m);
    }
  }
  return groups;
}

/**
 * Trim oldest history turn-groups until the system + tools + remaining
 * history fits within the budget. Returns kept messages (flattened) plus
 * whether any truncation occurred.
 *
 * Turn groups are atomic — never split. This prevents the orphan-user
 * case where the assistant reply was dropped but the user message
 * remained, leaving the model staring at a question with no answer.
 */
export function trimHistoryToBudget<T extends MessageLike>(
  systemPrompt: string,
  toolsJson: string,
  messages: T[],
  budget: Budget,
): { kept: T[]; truncated: boolean } {
  const fixed = estimateTokens(systemPrompt) + estimateTokens(toolsJson);
  const available = budget.total - fixed - budget.reservedForOutput - budget.reservedForNextUser;

  const groups = groupTurns(messages);
  const keptGroups: T[][] = [];
  let used = 0;
  let truncated = false;

  for (let i = groups.length - 1; i >= 0; i--) {
    const cost = groups[i].reduce((acc, m) => acc + estimateMessageTokens(m), 0);
    if (used + cost > available) {
      truncated = true;
      break;
    }
    keptGroups.unshift(groups[i]);
    used += cost;
  }
  return { kept: keptGroups.flat(), truncated };
}
