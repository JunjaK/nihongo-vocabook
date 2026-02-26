import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/crypto/aes';
import type { LlmProvider } from '@/lib/ocr/settings';
import { normalizeExtractedTerm, shouldRejectExtractedTerm } from '@/lib/ocr/term-filter';

interface RequestBody {
  imageBase64: string;
  locale?: string;
}

interface ExtractedWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number | null;
}

const PROVIDER_TIMEOUT_MS = 60_000;

function buildSystemPrompt(locale: string): string {
  const meaningLang = locale === 'ko' ? 'Korean' : 'English';
  const example = locale === 'ko' ? '먹다' : 'to eat';
  return [
    'You are a Japanese vocabulary extractor. Extract Japanese words/phrases that are VISIBLE in this image.',
    '',
    'RULES:',
    '1. Extract ONLY text written in Japanese (kanji, hiragana, katakana). If the image contains Korean, Chinese, or English, IGNORE it — do NOT translate or convert non-Japanese text into Japanese.',
    '2. The image may contain vertical text (top-to-bottom columns, read right-to-left). Read vertical columns carefully and combine characters into complete words.',
    '3. Prefer compound words over isolated single kanji. E.g., extract 純米吟醸 as one term, not 純, 米, 吟, 醸 separately. Extract single kanji only when it genuinely stands alone.',
    '4. Be thorough — extract ALL readable Japanese words including menu items, labels, descriptions, katakana loanwords, and proper nouns.',
    '5. Convert inflected forms to dictionary form (e.g. 食べました → 食べる).',
    '6. Skip unreadable or heavily obscured text.',
    '',
    `For each word: dictionary form (term), reading in hiragana, meaning in ${meaningLang}, JLPT level (1-5, 5=N5 easiest, 1=N1 hardest, or null).`,
    '',
    'EXCLUDE: bare prefixes/suffixes (お, ご, 的, 性, 化), bare inflection endings (ます, ない, する, た), noise (ーー, repeated chars), affix marks (無-, -的).',
    '',
    `Max 50 words. Return ONLY a JSON array: [{"term": "食べる", "reading": "たべる", "meaning": "${example}", "jlptLevel": 4}]. No explanation.`,
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as RequestBody;
  const { imageBase64, locale = 'ko' } = body;

  // Read provider & API key from DB
  const { data: settings } = await supabase
    .from('user_settings')
    .select('llm_provider, encrypted_api_key')
    .eq('user_id', user.id)
    .single();

  const provider = (settings?.llm_provider ?? 'openai') as LlmProvider;
  let apiKey: string | undefined;

  if (settings?.encrypted_api_key) {
    apiKey = decrypt(settings.encrypted_api_key);
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: 'API_KEY_REQUIRED' },
      { status: 400 },
    );
  }

  try {
    const words = await callProvider(provider, apiKey, imageBase64, locale, req.signal);
    return NextResponse.json({ words: words.slice(0, 50) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function createAbortError(): Error {
  return new DOMException('Aborted', 'AbortError');
}

function withTimeoutSignal(signal?: AbortSignal, timeoutMs = PROVIDER_TIMEOUT_MS): {
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

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const { signal: requestSignal, cleanup } = withTimeoutSignal(signal);
  try {
    return await fetch(input, { ...init, signal: requestSignal });
  } finally {
    cleanup();
  }
}

async function callProvider(
  provider: LlmProvider,
  apiKey: string,
  imageBase64: string,
  locale: string,
  signal?: AbortSignal,
): Promise<ExtractedWord[]> {
  switch (provider) {
    case 'openai':
      return callOpenAI(apiKey, imageBase64, locale, signal);
    case 'anthropic':
      return callAnthropic(apiKey, imageBase64, locale, signal);
    case 'gemini':
      return callGemini(apiKey, imageBase64, locale, signal);
  }
}

async function callOpenAI(
  apiKey: string,
  imageBase64: string,
  locale: string,
  signal?: AbortSignal,
): Promise<ExtractedWord[]> {
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildSystemPrompt(locale) },
            { type: 'image_url', image_url: { url: imageBase64 } },
          ],
        },
      ],
      reasoning_effort: 'medium',
      max_completion_tokens: 8192,
    }),
  }, signal);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const data = await res.json();
  const content: string = data.choices[0]?.message?.content ?? '[]';
  return parseJsonArray(content);
}

async function callAnthropic(
  apiKey: string,
  imageBase64: string,
  locale: string,
  signal?: AbortSignal,
): Promise<ExtractedWord[]> {
  const { mediaType, base64Data } = parseDataUrl(imageBase64);

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            { type: 'text', text: buildSystemPrompt(locale) },
          ],
        },
      ],
    }),
  }, signal);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${err}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
  const content: string = textBlock?.text ?? '[]';
  return parseJsonArray(content);
}

async function callGemini(
  apiKey: string,
  imageBase64: string,
  locale: string,
  signal?: AbortSignal,
): Promise<ExtractedWord[]> {
  const { mediaType, base64Data } = parseDataUrl(imageBase64);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: buildSystemPrompt(locale) },
            { inline_data: { mime_type: mediaType, data: base64Data } },
          ],
        },
      ],
      generationConfig: {
        thinkingConfig: { thinkingLevel: 'medium' },
      },
    }),
  }, signal);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${err}`);
  }

  const data = await res.json();
  // Gemini 3 may return thinking parts alongside text parts — find the text one
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const textPart = parts.find((p: { text?: string }) => typeof p.text === 'string');
  const content: string = textPart?.text ?? '[]';
  return parseJsonArray(content);
}

function parseDataUrl(dataUrl: string): { mediaType: string; base64Data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mediaType: match[1], base64Data: match[2] };
  }
  return { mediaType: 'image/jpeg', base64Data: dataUrl };
}

function parseJsonArray(content: string): ExtractedWord[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>[];
  const seen = new Set<string>();

  return parsed
    .filter(
      (w) => typeof w.term === 'string' && typeof w.reading === 'string' && typeof w.meaning === 'string',
    )
    .map((w) => {
      const term = normalizeExtractedTerm(w.term as string);
      const level = typeof w.jlptLevel === 'number' && w.jlptLevel >= 1 && w.jlptLevel <= 5
        ? w.jlptLevel
        : null;
      return {
        term,
        reading: w.reading as string,
        meaning: w.meaning as string,
        jlptLevel: level,
      };
    })
    .filter((word) => !shouldRejectExtractedTerm(word.term))
    .filter((word) => {
      if (seen.has(word.term)) return false;
      seen.add(word.term);
      return true;
    });
}
