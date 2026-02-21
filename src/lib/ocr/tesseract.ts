import { createWorker } from 'tesseract.js';

export async function extractWithTesseract(
  imageDataUrl: string,
  onProgress?: (progress: number) => void,
): Promise<string> {
  const worker = await createWorker('jpn', undefined, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    },
  });

  const { data } = await worker.recognize(imageDataUrl);
  await worker.terminate();

  return data.text;
}

const JAPANESE_WORD_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]+/g;

export function splitJapaneseText(text: string): string[] {
  const matches = text.match(JAPANESE_WORD_REGEX);
  if (!matches) return [];

  const unique = [...new Set(matches)];
  return unique.filter((w) => w.length >= 2 || /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(w));
}
