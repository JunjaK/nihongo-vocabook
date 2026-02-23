import type { Word, WordWithProgress } from '@/types/word';

/**
 * Weight based on priority: 1 (high) = 1.0, 2 (mid) = 0.7, 3 (low) = 0.4
 */
export function priorityWeight(priority: number): number {
  switch (priority) {
    case 1: return 1.0;
    case 2: return 0.7;
    case 3: return 0.4;
    default: return 0.7;
  }
}

/**
 * Weight based on JLPT level match.
 * If user's JLPT level is unknown (null), all words get equal weight.
 * Words at or above user's level get higher weight.
 */
export function jlptWeight(userJlpt: number | null, wordJlpt: number | null): number {
  if (userJlpt === null || wordJlpt === null) return 0.7;
  const diff = wordJlpt - userJlpt; // positive = word is harder
  if (diff === 0) return 1.0;
  if (diff === 1) return 0.9;
  if (diff === -1) return 0.8;
  if (diff > 1) return 0.6;
  return 0.5; // much easier word
}

/**
 * Overdue factor based on how past-due a word is.
 */
export function overdueFactor(progress: WordWithProgress['progress']): number {
  if (!progress) return 0.5; // new word — moderate priority
  const now = Date.now();
  const due = progress.nextReview.getTime();
  const diffDays = (now - due) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return 0.8; // not due yet
  if (diffDays <= 3) return 1.0;
  if (diffDays <= 7) return 1.2;
  return 1.5; // very overdue
}

/**
 * Calculate combined quiz score for a word (higher = should appear first).
 */
export function calcQuizScore(word: WordWithProgress, userJlpt: number | null): number {
  return (
    priorityWeight(word.priority) *
    jlptWeight(userJlpt, word.jlptLevel) *
    overdueFactor(word.progress)
  );
}

/**
 * Select words for practice mode (no SRS).
 * Weighted random using priority + JLPT weights.
 */
export function selectPracticeWords(
  words: Word[],
  limit: number,
  userJlpt: number | null,
): Word[] {
  const scored = words.map((w) => ({
    word: w,
    score:
      priorityWeight(w.priority) *
      jlptWeight(userJlpt, w.jlptLevel) *
      (0.5 + Math.random()),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.word);
}

/**
 * Score, sort descending, and slice candidates.
 */
export function selectDueWords(
  candidates: WordWithProgress[],
  limit: number,
  userJlpt: number | null,
): WordWithProgress[] {
  const scored = candidates.map((w) => ({
    word: w,
    score: calcQuizScore(w, userJlpt),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.word);
}
