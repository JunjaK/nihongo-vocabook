import type { Word, WordExample, WordWithProgress } from '@/types/word';
import type { QuizCard } from '@/types/quiz';

const MASK = '____';

/**
 * Replace all occurrences of `term` in `sentence` with a blank placeholder.
 * Falls back to returning the original sentence if the term is not found
 * (can happen when the sentence uses a different conjugation).
 */
export function maskSentence(sentence: string, term: string): string {
  if (!term) return sentence;
  if (sentence.includes(term)) {
    return sentence.split(term).join(MASK);
  }
  return sentence;
}

export const BLANK_PLACEHOLDER = MASK;

function pickTwo<T>(arr: T[], rng: () => number = Math.random): [T, T] | null {
  if (arr.length < 2) return null;
  const copy = [...arr];
  const pick = (): T => {
    const idx = Math.floor(rng() * copy.length);
    return copy.splice(idx, 1)[0];
  };
  return [pick(), pick()];
}

/**
 * Build an example quiz card.
 *
 * Picks a random example, masks the target term, and selects 2 distractors
 * from `distractorPool` (same JLPT level when possible, then random fallback).
 *
 * Returns null when preconditions are not met (e.g. not enough distractors).
 */
export function buildExampleCard(
  word: WordWithProgress,
  examples: WordExample[],
  distractorPool: Word[],
): QuizCard | null {
  if (examples.length === 0) return null;

  const otherWords = distractorPool.filter((w) => w.id !== word.id && w.term && w.term !== word.term);
  if (otherWords.length < 2) return null;

  // Prefer distractors at the same JLPT level when available
  const sameLevel = otherWords.filter((w) => w.jlptLevel === word.jlptLevel);
  const preferred = sameLevel.length >= 2 ? sameLevel : otherWords;

  const distractors = pickTwo(preferred);
  if (!distractors) return null;

  // Pick a random example (prefer one that contains the term literally, if any)
  const withMatch = examples.filter((e) => e.sentenceJa.includes(word.term));
  const example = (withMatch.length > 0 ? withMatch : examples)[
    Math.floor(Math.random() * (withMatch.length > 0 ? withMatch.length : examples.length))
  ];

  return {
    kind: 'example',
    word,
    example,
    distractors,
  };
}
