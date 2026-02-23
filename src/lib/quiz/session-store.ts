export type QuizMode = 'general' | 'quickstart';

export type QuizSessionSnapshot = {
  version: 1;
  mode: QuizMode;
  kstDate: string; // YYYY-MM-DD in KST — invalid if date rolled
  updatedAt: number;
  wordIds: string[]; // full ordered word ID list
  currentIndex: number;
  completed: number;
  sessionStats: {
    totalReviewed: number;
    newCards: number;
    againCount: number;
  };
};

function sessionKey(mode: QuizMode): string {
  return `quiz:session:${mode}`;
}

export function getKstDateString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

export function readSession(mode: QuizMode): QuizSessionSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(sessionKey(mode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuizSessionSnapshot;
    if (!parsed || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.wordIds) || parsed.wordIds.length === 0) return null;
    if (parsed.kstDate !== getKstDateString()) {
      window.localStorage.removeItem(sessionKey(mode));
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
  } catch {
    // Ignore
  }
}
