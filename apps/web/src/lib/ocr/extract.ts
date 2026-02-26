import type { OcrMode } from './settings';
import type { ExtractedWord } from './llm-vision';

export type ExtractionResult =
  | { mode: 'ocr'; words: string[] }
  | { mode: 'llm'; words: ExtractedWord[] };

export async function extractWordsFromImage(
  imageDataUrl: string,
  mode: OcrMode,
  onProgress?: (progress: number) => void,
  locale?: string,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  if (mode === 'llm') {
    const { extractWithLlm } = await import('./llm-vision');
    const words = await extractWithLlm(imageDataUrl, locale, signal);
    return { mode: 'llm', words };
  }

  const { extractWithTesseract } = await import('./tesseract');
  const words = await extractWithTesseract(imageDataUrl, onProgress, signal);
  return { mode: 'ocr', words };
}
