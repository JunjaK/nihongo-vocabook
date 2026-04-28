import type { Word, WordExample, WordWithProgress } from '@/types/word';
import type { QuizCard } from '@/types/quiz';

const MASK = '____';

export const BLANK_PLACEHOLDER = MASK;

const HIRAGANA_START = 0x3040;
const HIRAGANA_END = 0x309f;
const KANJI_START = 0x4e00;
const KANJI_END = 0x9faf;

function isHiragana(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return code >= HIRAGANA_START && code <= HIRAGANA_END;
}

function hasKanji(s: string): boolean {
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= KANJI_START && code <= KANJI_END) return true;
  }
  return false;
}

/**
 * Find the substring of `sentence` to mask as the blank for fill-in-the-blank.
 *
 * Strategy:
 *  1. Direct: if the sentence contains the dictionary `term` verbatim, use it.
 *  2. Inflected: trim trailing hiragana from `term` one character at a time,
 *     trying each remaining prefix. Accept the first prefix that (a) still
 *     contains a kanji and (b) appears in the sentence. This covers the
 *     vast majority of inflected verbs/adjectives whose kanji stem is stable
 *     while only the trailing kana conjugates (走る → 走 / 食べる → 食べ /
 *     大きい → 大き).
 *  3. Pure-kana terms (する, できる, あげる, ...) without a kanji anchor are
 *     not retried — returns null so the caller can drop the example card.
 *
 * Returns null when no safe mask span can be located.
 */
export function findMaskTarget(sentence: string, term: string): string | null {
  if (!term || !sentence) return null;
  if (sentence.includes(term)) return term;

  let prefix = term;
  while (prefix.length > 1 && isHiragana(prefix[prefix.length - 1])) {
    prefix = prefix.slice(0, -1);
    if (!hasKanji(prefix)) return null;
    if (sentence.includes(prefix)) return prefix;
  }
  return null;
}

/**
 * Replace all occurrences of the masking target in `sentence` with the blank
 * placeholder. Returns the original sentence unchanged when no safe target
 * can be located (defensive — `buildExampleCard` filters these out earlier).
 */
export function maskSentence(sentence: string, term: string): string {
  const target = findMaskTarget(sentence, term);
  if (!target) return sentence;
  return sentence.split(target).join(MASK);
}

/**
 * Pick `count` distinct items from `arr`. Items are deduped by `keyFn`
 * (e.g., distractor word `term`) so the final selection contains no
 * duplicate keys. Returns null if fewer than `count` unique keys are
 * available.
 */
function pickDistinct<T>(
  arr: T[],
  count: number,
  keyFn: (item: T) => string,
  rng: () => number = Math.random,
): T[] | null {
  if (arr.length < count) return null;

  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of shuffled) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length === count) return out;
  }
  return null;
}

/**
 * Build an example quiz card.
 *
 * Picks an example whose sentence contains a maskable form of the target
 * word (see `findMaskTarget`), and selects 2 distractor words with terms
 * distinct from the correct term and from each other (same JLPT level
 * preferred; falls back to any). Returns null when the example cannot
 * be safely rendered as a fill-in-the-blank — caller falls back to a
 * regular word card.
 */
export function buildExampleCard(
  word: WordWithProgress,
  examples: WordExample[],
  distractorPool: Word[],
): QuizCard | null {
  if (examples.length === 0) return null;

  const otherWords = distractorPool.filter(
    (w) => w.id !== word.id && w.term && w.term !== word.term,
  );
  if (otherWords.length < 2) return null;

  const sameLevel = otherWords.filter((w) => w.jlptLevel === word.jlptLevel);
  const preferred = sameLevel.length >= 2 ? sameLevel : otherWords;

  const distractors = pickDistinct(preferred, 2, (w) => w.term)
    ?? pickDistinct(otherWords, 2, (w) => w.term);
  if (!distractors) return null;

  const matchable = examples
    .map((e) => ({ example: e, target: findMaskTarget(e.sentenceJa, word.term) }))
    .filter((x): x is { example: WordExample; target: string } => x.target !== null);
  if (matchable.length === 0) return null;

  const chosen = matchable[Math.floor(Math.random() * matchable.length)];

  return {
    kind: 'example',
    word,
    example: chosen.example,
    distractors: [distractors[0], distractors[1]],
    maskTarget: chosen.target,
  };
}
