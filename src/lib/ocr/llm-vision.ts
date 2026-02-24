export interface ExtractedWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number | null;
}

export async function extractWithLlm(
  imageDataUrl: string,
  locale?: string,
): Promise<ExtractedWord[]> {
  const res = await fetch('/api/ocr/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: imageDataUrl, locale }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? 'LLM extraction failed');
  }

  const data: { words: ExtractedWord[] } = await res.json();
  return data.words;
}
