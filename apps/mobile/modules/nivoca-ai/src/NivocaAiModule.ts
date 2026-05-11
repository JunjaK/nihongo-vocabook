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
}

// Loads the native module object from JSI. Throws on platforms where the
// module is not present (web; Android until we ship a runner there).
export default requireNativeModule<NivocaAiModule>('NivocaAi');
