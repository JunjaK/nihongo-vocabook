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
}

// Loads the native module object from JSI. Throws on platforms where the
// module is not present (web; Android until we ship a runner there).
export default requireNativeModule<NivocaAiModule>('NivocaAi');
