export interface ExtractedWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number | null;
}

const LLM_FETCH_TIMEOUT_MS = 30_000;

function createAbortError(): Error {
  return new DOMException('Aborted', 'AbortError');
}

function withTimeoutSignal(signal?: AbortSignal, timeoutMs = LLM_FETCH_TIMEOUT_MS): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(createAbortError()), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason ?? createAbortError());

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason ?? createAbortError());
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', onAbort);
    },
  };
}

export async function extractWithLlm(
  imageDataUrl: string,
  locale?: string,
  signal?: AbortSignal,
): Promise<ExtractedWord[]> {
  const { signal: requestSignal, cleanup } = withTimeoutSignal(signal);
  let res: Response;
  try {
    res = await fetch('/api/ocr/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: imageDataUrl, locale }),
      signal: requestSignal,
    });
  } finally {
    cleanup();
  }

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error ?? 'LLM extraction failed');
  }

  const data: { words: ExtractedWord[] } = await res.json();
  return data.words;
}
