import type { ExtractedWord } from '@/lib/ocr/llm-vision';

export type ModelStatus =
  | { state: 'not_installed' }
  | {
      state: 'downloading';
      progress: number;
      loadedBytes?: number;
      totalBytes?: number;
      speedBps?: number;
      etaSeconds?: number;
    }
  | { state: 'installed' }
  | { state: 'error'; message: string };

export interface AiVisionAdapter {
  isReady(): Promise<boolean>;
  extractWords(
    imageDataUrl: string,
    locale: string,
    signal?: AbortSignal,
  ): Promise<ExtractedWord[]>;
}

export type ModelStatusListener = (status: ModelStatus) => void;
