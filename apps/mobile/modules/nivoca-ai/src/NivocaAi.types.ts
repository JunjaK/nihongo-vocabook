/**
 * Status of the on-device AI model lifecycle, mirrored on the web side via
 * the existing bridge. State strings deliberately match
 * `apps/web/src/lib/ai/types.ts:ModelStatus`.
 */
export type ModelStatusState = 'not_installed' | 'downloading' | 'installed' | 'error';

export interface ModelStatusPayload {
  state: ModelStatusState;
  progress?: number;
  loadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

export type NivocaAiModuleEvents = {
  /**
   * Emitted on download progress + state transitions (throttled to ≤1 Hz on
   * the native side to keep React Native bridge traffic low).
   */
  onModelStatus: (payload: ModelStatusPayload) => void;
};
