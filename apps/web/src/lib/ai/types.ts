import type {
  AiModelStatusSnapshot,
  AiModelVariantId,
} from '@/lib/native-bridge';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';

/** Re-exported for app code that doesn't need to know the snapshot lives
 *  in `native-bridge.ts`. */
export type { AiModelStatusSnapshot, AiModelVariantId };

/** Per-variant view derived from `AiModelStatusSnapshot`. The UI maps this
 *  to button states (Download / Selected / Delete) so it never has to
 *  reimplement the same conditional plumbing in two places. */
export type VariantUiState =
  | { kind: 'not_installed' }
  | {
      kind: 'downloading';
      progress: number;
      loadedBytes?: number;
      totalBytes?: number;
    }
  | { kind: 'installed_active' }
  | { kind: 'installed_inactive' }
  | { kind: 'error'; message: string };

export interface AiVisionAdapter {
  isReady(): Promise<boolean>;
  extractWords(
    imageDataUrl: string,
    locale: string,
    signal?: AbortSignal,
  ): Promise<ExtractedWord[]>;
}

export type SnapshotListener = (snapshot: AiModelStatusSnapshot) => void;

const EMPTY_SNAPSHOT: AiModelStatusSnapshot = {
  installed: [],
  active: null,
  downloading: null,
  error: null,
};

export function emptySnapshot(): AiModelStatusSnapshot {
  return EMPTY_SNAPSHOT;
}

export function variantUiState(
  snapshot: AiModelStatusSnapshot,
  variantId: AiModelVariantId,
): VariantUiState {
  if (snapshot.error?.variantId === variantId) {
    return { kind: 'error', message: snapshot.error.message };
  }
  if (snapshot.downloading?.variantId === variantId) {
    return {
      kind: 'downloading',
      progress: snapshot.downloading.progress,
      loadedBytes: snapshot.downloading.loadedBytes,
      totalBytes: snapshot.downloading.totalBytes,
    };
  }
  if (snapshot.installed.includes(variantId)) {
    return snapshot.active === variantId
      ? { kind: 'installed_active' }
      : { kind: 'installed_inactive' };
  }
  return { kind: 'not_installed' };
}
