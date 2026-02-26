export type OcrMode = 'ocr' | 'llm' | 'hybrid';
export type LlmProvider = 'openai' | 'anthropic' | 'gemini';

export interface OcrServerSettings {
  llmProvider: LlmProvider;
  apiKey: string;
  hasApiKey: boolean;
}

const MODE_STORAGE_KEY = 'nihongo-vocabook-ocr-mode';

/** Read OCR mode from localStorage (safe for guest mode) */
export function getLocalOcrMode(): OcrMode {
  if (typeof window === 'undefined') return 'ocr';
  const stored = localStorage.getItem(MODE_STORAGE_KEY);
  if (stored === 'llm' || stored === 'hybrid') return stored;
  return 'ocr';
}

/** Save OCR mode to localStorage */
export function setLocalOcrMode(mode: OcrMode): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MODE_STORAGE_KEY, mode);
}

/** Fetch LLM provider settings from server */
export async function fetchOcrSettings(): Promise<OcrServerSettings> {
  const res = await fetch('/api/settings/ocr');
  if (!res.ok) {
    throw new Error('Failed to fetch OCR settings');
  }
  return res.json() as Promise<OcrServerSettings>;
}

/** Save LLM provider settings to server */
export async function saveOcrSettings(
  settings: { llmProvider: LlmProvider; apiKey?: string },
): Promise<void> {
  const res = await fetch('/api/settings/ocr', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    throw new Error('Failed to save OCR settings');
  }
}
