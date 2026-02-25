export { getLocalDateString } from './date-utils';
import { getLocalDateString } from './date-utils';

export type QuizMode = 'general' | 'quickstart';

export type QuizSessionSnapshot = {
  version: 2;
  mode: QuizMode;
  date: string; // YYYY-MM-DD in browser-local timezone — invalid if date rolled
  updatedAt: number;
  wordIds: string[]; // full ordered word ID list
  currentIndex: number;
  completed: number;
  totalSessionSize: number; // original word count at session start (stable denominator)
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

function sessionKey(mode: QuizMode): string {
  return `quiz:session:${mode}`;
}

export function readSession(mode: QuizMode): QuizSessionSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(sessionKey(mode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuizSessionSnapshot;
    if (!parsed) return null;
    const version = (parsed as Record<string, unknown>).version;
    if (version !== 1 && version !== 2) return null;
    if (!Array.isArray(parsed.wordIds) || parsed.wordIds.length === 0) return null;
    // Accept both new `date` and legacy `kstDate` field
    const storedDate = parsed.date ?? (parsed as Record<string, unknown>)['kstDate'];
    if (storedDate !== getLocalDateString()) {
      window.localStorage.removeItem(sessionKey(mode));
      return null;
    }
    // Backfill split accuracy fields for old sessions (v1)
    if (parsed.sessionStats.reviewAgainCount === undefined) {
      parsed.sessionStats.reviewAgainCount = 0;
      parsed.sessionStats.newAgainCount = 0;
    }
    // Backfill per-rating counts for v1 sessions
    if (parsed.sessionStats.hardCount === undefined) {
      parsed.sessionStats.hardCount = 0;
      parsed.sessionStats.goodCount = 0;
      parsed.sessionStats.easyCount = 0;
      parsed.sessionStats.masteredCount = 0;
    }
    // Backfill totalSessionSize for sessions saved before this field existed
    if (!parsed.totalSessionSize) {
      parsed.totalSessionSize = parsed.wordIds.length + (parsed.sessionStats.masteredCount ?? 0);
    }
    parsed.version = 2;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(snapshot: QuizSessionSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(sessionKey(snapshot.mode), JSON.stringify(snapshot));
  } catch {
    // Quota exceeded — graceful degradation
  }
}

export function clearSession(mode: QuizMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(sessionKey(mode));
  } catch {
    // Ignore
  }
}

export function clearAllSessions(): void {
  clearSession('general');
  clearSession('quickstart');
}

export function cleanupLegacyKeys(): void {
  if (typeof window === 'undefined') return;
  if (window.localStorage.getItem('quiz:legacy-cleanup-done')) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith('quiz:srs-session:')) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
    window.localStorage.setItem('quiz:legacy-cleanup-done', '1');
  } catch {
    // Ignore
  }
}
