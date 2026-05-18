import { registerWebModule, NativeModule } from 'expo';

import type { ModelStatusPayload, NivocaAiModuleEvents } from './NivocaAi.types';

/**
 * Web stub for the NivocaAi native module. The Expo web bundle still needs to
 * import this symbol because the package is dual-platform, but the web app
 * uses its own transformers.js pipeline — nothing here should ever be called
 * on web. Methods reject loudly so accidental usage surfaces immediately.
 */
class NivocaAiModule extends NativeModule<NivocaAiModuleEvents> {
  ping(): string {
    return 'nivoca-ai:web:stub';
  }
  async startDownload(_modelUrl: string, _fileName: string): Promise<void> {
    throw new Error('NivocaAi is iOS-only — startDownload is unsupported on web');
  }
  async cancelDownload(): Promise<void> {
    throw new Error('NivocaAi is iOS-only — cancelDownload is unsupported on web');
  }
  async deleteModel(): Promise<void> {
    throw new Error('NivocaAi is iOS-only — deleteModel is unsupported on web');
  }
  async getStatus(): Promise<ModelStatusPayload> {
    return { state: 'not_installed' };
  }
  async infer(_prompt: string, _imagePath: string): Promise<string> {
    throw new Error('NivocaAi is iOS-only — infer is unsupported on web');
  }
  async inferText(_requestJson: string): Promise<string> {
    throw new Error('NivocaAi is iOS-only — inferText is unsupported on web');
  }
  async inferTextStream(_requestId: string, _requestJson: string): Promise<void> {
    throw new Error('NivocaAi is iOS-only — inferTextStream is unsupported on web');
  }
  async cancelInferText(_requestId: string): Promise<void> {
    throw new Error('NivocaAi is iOS-only — cancelInferText is unsupported on web');
  }
  async prewarm(): Promise<void> {
    throw new Error('NivocaAi is iOS-only — prewarm is unsupported on web');
  }
  getMemoryProbe(): {
    physicalBytes: number;
    availableBytes: number;
    projectedCacheSize: number;
    entitlementsHint: 'elevated' | 'default_cap' | 'simulator_or_unavailable';
    buildType: 'debug' | 'release';
  } {
    return {
      physicalBytes: 0,
      availableBytes: 0,
      projectedCacheSize: 0,
      entitlementsHint: 'simulator_or_unavailable',
      buildType: 'release',
    };
  }
}

export default registerWebModule(NivocaAiModule, 'NivocaAiModule');
