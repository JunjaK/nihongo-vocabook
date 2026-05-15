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

const MAX_WORDBOOK_SAMPLE = 30;

export function baseSystemPrompt(locale: string): string {
  const lang = locale === 'ko' ? 'Korean' : 'English';
  const isKo = locale === 'ko';
  // Token-tight system prompt. Tool call format + emit-in-one-turn rules now
  // live on the Swift side after the tool catalog (one source of truth). Here
  // we cover behavior the model gets wrong without a hint: don't invent IDs,
  // don't call tools for pure explain/meta questions, respond language.
  return [
    "You're a Japanese vocabulary assistant.",
    `Reply in ${lang}; keep Japanese terms in kanji+kana.`,
    'Never invent word/wordbook IDs — search_words first or ask.',
    'Never call delete_* unless the user explicitly asks to delete.',
    'For "what does X mean?" / meta questions, answer in natural language without any tool call.',
    isKo
      ? '예시 — 사용자: "桜 뜻이 뭐야?"  어시스턴트: "桜(さくら)는 「벚꽃」을 뜻해요."'
      : 'Example — User: "What does 桜 mean?"  Assistant: "桜 (さくら) means cherry blossom."',
  ].join('\n');
}

function wordContextBlock(word: Word, wordbooks: WordbookWithCount[]): string {
  const wbNames = wordbooks.length > 0 ? wordbooks.map((w) => w.name).join(', ') : '(none)';
  const lines = [
    '',
    'CURRENT WORD:',
    `  id: ${word.id}`,
    `  term: ${word.term}`,
    `  reading: ${word.reading}`,
    `  meaning: ${word.meaning}`,
    `  jlpt: ${word.jlptLevel ?? 'unknown'}`,
    `  mastered: ${word.mastered ? 'true' : 'false'}`,
    `  wordbooks: [${wbNames}]`,
  ];
  return lines.join('\n');
}

function wordbookContextBlock(
  wb: WordbookWithCount,
  sample: Word[],
): string {
  const sampleLines = sample
    .slice(0, MAX_WORDBOOK_SAMPLE)
    .map((w) => `    ${w.id}: ${w.term} (${w.reading}) — ${w.meaning}`)
    .join('\n');
  return [
    '',
    'CURRENT WORDBOOK:',
    `  id: ${wb.id}`,
    `  name: ${wb.name}`,
    `  description: ${wb.description ?? ''}`,
    `  totalWords: ${wb.wordCount}`,
    `  sampleWords (first ${Math.min(sample.length, MAX_WORDBOOK_SAMPLE)}):`,
    sampleLines || '    (no words)',
    '',
    'If you need words not in this sample, use search_words.',
  ].join('\n');
}

function quizContextBlock(
  word: Word | null,
  lastRating: number | undefined,
): string {
  if (!word) {
    return [
      '',
      'CURRENT QUIZ CARD: (no card visible — the session may have ended)',
    ].join('\n');
  }
  const ratingMap: Record<number, string> = {
    1: 'again',
    2: 'hard',
    3: 'good',
    4: 'easy',
  };
  return [
    '',
    'The user just answered a quiz card and asked for help.',
    '',
    'CURRENT CARD:',
    `  id: ${word.id}`,
    `  term: ${word.term}`,
    `  reading: ${word.reading}`,
    `  meaning: ${word.meaning}`,
    `  user's rating: ${lastRating !== undefined ? (ratingMap[lastRating] ?? `unknown(${lastRating})`) : 'unknown'}`,
    '',
    'Provide explanation, mnemonics, or example sentences. Do not influence future ratings — the user has already rated this card.',
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

const TOKEN_BUDGET = 2048;
const RESERVED_FOR_OUTPUT = 600;
const RESERVED_FOR_NEXT_USER = 200;
const IMAGE_TOKEN_COST = 256;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const AUDIO_TOKEN_COST = 384; // rough per-clip estimate; updated when verified

interface MessageLike {
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
    if (block.type === 'text') {
      total += estimateTokens(block.text);
    } else if (block.type === 'image') {
      total += IMAGE_TOKEN_COST;
    } else if (block.type === 'audio') {
      total += AUDIO_TOKEN_COST;
    } else if (block.type === 'tool_result') {
      total += estimateTokens(JSON.stringify(block.result ?? {}));
    }
  }
  return total;
}

/**
 * Trim oldest history messages until the system + tools + history fits within
 * the token budget. Returns the trimmed list and a boolean indicating whether
 * truncation occurred.
 */
export function trimHistoryToBudget<T extends MessageLike>(
  systemPrompt: string,
  toolsJson: string,
  messages: T[],
): { kept: T[]; truncated: boolean } {
  const fixed = estimateTokens(systemPrompt) + estimateTokens(toolsJson);
  const available = TOKEN_BUDGET - fixed - RESERVED_FOR_OUTPUT - RESERVED_FOR_NEXT_USER;

  const kept: T[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i]);
    if (used + cost > available) {
      return { kept, truncated: true };
    }
    kept.unshift(messages[i]);
    used += cost;
  }
  return { kept, truncated: false };
}
