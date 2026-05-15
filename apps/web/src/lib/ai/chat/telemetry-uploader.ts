/**
 * Opt-in anonymous telemetry uploader.
 *
 * Mirrors a subset of local metric events to Supabase so we can answer
 * product questions like "which tools are popular" or "are inferences
 * timing out for some users." NEVER carries message content, tool args,
 * or any free-form user text — only counters and enum strings.
 *
 * Strategy:
 *  - In-memory queue, flushed every 60s OR when 50 events accumulate
 *  - Also flushed on `visibilitychange → hidden` (best-effort)
 *  - Disabled (no-op) when the user pref is OFF
 *  - Repository layer scrubs payload values defensively (see scrubPayload)
 *
 * Initialize via `installTelemetryUploader(repo)` from the app shell.
 */

import type { DataRepository } from '@/lib/repository/types';
import type { AiTelemetryEvent } from '@/types/chat';
import { getTelemetryEnabled, subscribeAssistantPrefs } from '../assistant-prefs';

const FLUSH_INTERVAL_MS = 60_000;
const FLUSH_THRESHOLD = 50;
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev';

let queue: AiTelemetryEvent[] = [];
let installed: { repo: DataRepository; teardown: () => void } | null = null;

function platform(): 'ios' | 'web' {
  if (typeof window === 'undefined') return 'web';
  const w = window as Window & { NiVocaBridge?: { platform?: string } };
  return w.NiVocaBridge?.platform === 'ios' ? 'ios' : 'web';
}

export function recordTelemetry(
  event: string,
  payload: Record<string, number | string | boolean | null>,
  scope?: AiTelemetryEvent['scope'],
): void {
  if (!getTelemetryEnabled()) return;
  queue.push({
    event,
    payload,
    scope,
    platform: platform(),
    appVersion: APP_VERSION,
    timestamp: Date.now(),
  });
  if (queue.length >= FLUSH_THRESHOLD) {
    void flush();
  }
}

async function flush(): Promise<void> {
  if (!installed) return;
  if (!getTelemetryEnabled()) {
    // Toggle flipped OFF between queue and flush — drop everything.
    queue = [];
    return;
  }
  const batch = queue;
  queue = [];
  if (batch.length === 0) return;
  try {
    await installed.repo.chat.uploadTelemetry(batch);
  } catch (err) {
    // Don't requeue indefinitely; one retry is enough.
    console.warn('[telemetry] upload failed', err);
  }
}

export function installTelemetryUploader(repo: DataRepository): () => void {
  if (installed) installed.teardown();

  const interval = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onHide);
  }

  // If the user toggles OFF mid-session, drop the queue (don't send stale data).
  const unsubPrefs = subscribeAssistantPrefs(() => {
    if (!getTelemetryEnabled()) queue = [];
  });

  const teardown = () => {
    clearInterval(interval);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onHide);
    }
    unsubPrefs();
    installed = null;
  };
  installed = { repo, teardown };
  return teardown;
}
