import { NativeModule, requireNativeModule } from 'expo';

import type { ModelStatusPayload, NivocaAiModuleEvents } from './NivocaAi.types';

declare class NivocaAiModule extends NativeModule<NivocaAiModuleEvents> {
  /** Phase-A heartbeat — returns `nivoca-ai:ios:phase-a`. Remove after wiring. */
  ping(): string;

  /** Phase C — kick off a resumable download. Native side emits `onModelStatus`. */
  startDownload(modelUrl: string, fileName: string): Promise<void>;
  cancelDownload(): Promise<void>;
  deleteModel(): Promise<void>;
  getStatus(): Promise<ModelStatusPayload>;

  /** Phase D — multimodal inference. `imagePath` must be an absolute file path. */
  infer(prompt: string, imagePath: string): Promise<string>;

  /**
   * Phase 0 (PoC) — blocking text-only inference. `requestJson` is the
   * JSON-encoded form of `AiTextInferRequest`. Returns the raw model text
   * (including any `<tool_call>...</tool_call>` tags). Phase 1 will add a
   * streaming variant that emits tokens via an event channel.
   */
  inferText(requestJson: string): Promise<string>;

  /**
   * Phase 1 — streaming text inference. `requestJson` is the JSON-encoded
   * form of `AiTextInferRequest`. Resolves once the stream is *started*;
   * actual chunks arrive via `onInferStreamToken` events keyed on
   * `requestId`. Completion fires `onInferStreamDone`, errors fire
   * `onInferStreamError`.
   */
  inferTextStream(requestId: string, requestJson: string): Promise<void>;

  /**
   * Phase 1 — cancel an in-flight stream. Safe to call with an unknown
   * requestId (no-op). The engine emits a final frame after cancel, so
   * `onInferStreamDone` still fires (with `cancelled: true`).
   */
  cancelInferText(requestId: string): Promise<void>;

  /**
   * Phase 1.5 — pre-warm the engine without running any inference. Loads the
   * model + sampler config into memory so the first real inference call
   * doesn't pay the 5-15s cold-start cost. Rejects if model is missing or all
   * backends fail.
   */
  prewarm(): Promise<void>;

  /**
   * C5 — query the active engine's capability snapshot: context-window size
   * chosen by `pickKVCacheSize()`, backend selected (gpu/cpu), and whether
   * Multi-Token Prediction is enabled. Resolves immediately if the engine is
   * loaded; returns zero/unknown if not.
   */
  getEngineInfo(): Promise<{
    maxNumTokens: number;
    backend: 'gpu' | 'cpu' | 'unknown';
    mtpEnabled: boolean;
  }>;
}

// Loads the native module object from JSI. Throws on platforms where the
// module is not present (web; Android until we ship a runner there).
export default requireNativeModule<NivocaAiModule>('NivocaAi');
