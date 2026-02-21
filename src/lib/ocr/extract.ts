import type { OcrMode } from './settings';
import type { ExtractedWord } from './llm-vision';

export type ExtractionResult =
  | { mode: 'ocr'; words: string[] }
  | { mode: 'llm'; words: ExtractedWord[] };

export async function extractWordsFromImage(
  imageDataUrl: string,
  mode: OcrMode,
  onProgress?: (progress: number) => void,
): Promise<ExtractionResult> {
  if (mode === 'llm') {
    const { extractWithLlm } = await import('./llm-vision');
    const words = await extractWithLlm(imageDataUrl);
    return { mode: 'llm', words };
  }

  const { extractWithTesseract, splitJapaneseText } = await import('./tesseract');
  const rawText = await extractWithTesseract(imageDataUrl, onProgress);
  const words = splitJapaneseText(rawText);
  return { mode: 'ocr', words };
}
