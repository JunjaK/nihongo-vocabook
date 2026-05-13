'use client';

import type { AiModelStatusSnapshot } from '@/lib/native-bridge';
import {
  emptySnapshot,
  type SnapshotListener,
} from './types';

/**
 * Web-side mirror of the native multi-variant model status. Lives in WebView
 * memory only — the source of truth is `apps/mobile/src/lib/ai/model-manager.ts`.
 * The native side pushes `AI_MODEL_STATUS_RESULT` snapshots through the
 * bridge; `setSnapshot` here just routes them to subscribed UI components.
 */

let currentSnapshot: AiModelStatusSnapshot = emptySnapshot();
const listeners = new Set<SnapshotListener>();

function emit(): void {
  for (const listener of listeners) listener(currentSnapshot);
}

export function getSnapshot(): AiModelStatusSnapshot {
  return currentSnapshot;
}

export function subscribeSnapshot(listener: SnapshotListener): () => void {
  listeners.add(listener);
  listener(currentSnapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function setSnapshot(snapshot: AiModelStatusSnapshot): void {
  currentSnapshot = snapshot;
  emit();
}
