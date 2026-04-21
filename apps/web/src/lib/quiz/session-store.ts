export { getLocalDateString } from './date-utils';
import { getLocalDateString } from './date-utils';

/**
 * Persisted session snapshot (localStorage).
 *
 * Stores the word IDs that make up today's session plus progress tracking.
 * Card types (word vs example) are re-derived on load so we don't persist
 * heavy example/distractor payloads.
 */
export type QuizSessionSnapshot = {
  version: 3;
  date: string; // YYYY-MM-DD in browser-local tz; invalid if rolled
  updatedAt: number;
  wordIds: string[]; // ordered word list for the session
  currentIndex: number;
  completed: number;
  sessionStats: {
    totalReviewed: number;
    newCards: number;
    againCount: number;
    reviewAgainCount: number;
    newAgainCount: number;
    hardCount: number;
    goodCount: number;
    easyCount: number;
    masteredCount: number;
  };
};

const SESSION_KEY = 'quiz:session';

export function readSession(): QuizSessionSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuizSessionSnapshot;
    if (!parsed || parsed.version !== 3) return null;
    if (!Array.isArray(parsed.wordIds) || parsed.wordIds.length === 0) return null;
    if (parsed.date !== getLocalDateString()) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(snapshot: QuizSessionSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded — graceful degradation
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Remove legacy localStorage keys from prior quiz versions.
 * Runs idempotently (guarded by a flag key).
 */
export function cleanupLegacyKeys(): void {
  if (typeof window === 'undefined') return;
  if (window.localStorage.getItem('quiz:legacy-cleanup-v3')) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (
        key.startsWith('quiz:srs-session:') ||
        key === 'quiz:session:general' ||
        key === 'quiz:session:quickstart' ||
        key === 'quiz:legacy-cleanup-done'
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
    window.localStorage.setItem('quiz:legacy-cleanup-v3', '1');
  } catch {
    // Ignore
  }
}
