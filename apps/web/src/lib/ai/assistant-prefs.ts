/**
 * Lightweight user preferences for the AI Assistant.
 *
 * Stored in `localStorage` so they survive reloads but don't sync across
 * devices. If the user wants cross-device sync later, promote these into the
 * `user_settings` Supabase table.
 *
 * Read paths use a defensive `try/catch` because Safari Private Mode + iOS
 * WebView storage quotas can occasionally throw on `getItem`. We always fall
 * back to the safe default in that case.
 */

const KEY_SAVE_QUIZ_AI_SESSIONS = 'nivoca.assistant.save-quiz-sessions';
const KEY_PREWARM = 'nivoca.assistant.prewarm';
const KEY_TELEMETRY = 'nivoca.assistant.telemetry';

/**
 * When ON, AI chat messages produced inside a quiz session are persisted to
 * the `ai_sessions` / `ai_messages` tables (same path as the general session).
 * When OFF (default), the quiz session stays in-memory only and is discarded
 * when the user leaves the quiz page or remounts the chat store.
 */
export function getSaveQuizAiSessions(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY_SAVE_QUIZ_AI_SESSIONS) === '1';
  } catch {
    return false;
  }
}

export function setSaveQuizAiSessions(value: boolean): void {
  setPref(KEY_SAVE_QUIZ_AI_SESSIONS, value);
}

/**
 * When ON, the native engine is pre-loaded on app boot (or when the toggle is
 * flipped) so the first inference call doesn't pay the cold-start cost.
 * Costs ~250 MB of resident memory while loaded; default OFF.
 */
export function getPrewarm(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY_PREWARM) === '1';
  } catch {
    return false;
  }
}

export function setPrewarm(value: boolean): void {
  setPref(KEY_PREWARM, value);
}

/**
 * When ON, anonymous AI usage telemetry (latency, tool counters, error codes)
 * is batched and uploaded to Supabase. Default OFF. NEVER includes message
 * content, attachments, or any user-authored text — only counters.
 */
export function getTelemetryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY_TELEMETRY) === '1';
  } catch {
    return false;
  }
}

export function setTelemetryEnabled(value: boolean): void {
  setPref(KEY_TELEMETRY, value);
}

function setPref(key: string, value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(key, '1');
    } else {
      window.localStorage.removeItem(key);
    }
    window.dispatchEvent(new CustomEvent('nivoca:assistant-prefs-changed'));
  } catch {
    /* swallow — toggle is best-effort */
  }
}

/**
 * Subscribe to pref changes. Returns an unsubscribe function. Fires for the
 * in-tab `nivoca:assistant-prefs-changed` event AND the cross-tab native
 * `storage` event (the latter so a settings tab and a quiz tab stay in sync
 * inside the same WebView).
 */
export function subscribeAssistantPrefs(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const customHandler = () => listener();
  const storageHandler = (e: StorageEvent) => {
    if (e.key === KEY_SAVE_QUIZ_AI_SESSIONS) listener();
  };
  window.addEventListener('nivoca:assistant-prefs-changed', customHandler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener('nivoca:assistant-prefs-changed', customHandler);
    window.removeEventListener('storage', storageHandler);
  };
}
