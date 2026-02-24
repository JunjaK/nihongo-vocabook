import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/crypto/aes';
import type { LlmProvider } from '@/lib/ocr/settings';

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

function buildSystemPrompt(locale: string): string {
  const meaningLang = locale === 'ko' ? 'Korean' : 'English';
  const example = locale === 'ko' ? '먹다' : 'to eat';
  return `Extract all Japanese words/phrases from this image. For each word, provide the dictionary form (term), reading in hiragana, meaning in ${meaningLang}, and estimated JLPT level (1-5, where 5=N5 easiest, 1=N1 hardest, or null if unknown). Return ONLY a JSON array of objects: [{"term": "食べる", "reading": "たべる", "meaning": "${example}", "jlptLevel": 4}]. No explanation.`;
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
    const words = await callProvider(provider, apiKey, imageBase64, locale);
    return NextResponse.json({ words });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function callProvider(
  provider: LlmProvider,
  apiKey: string,
  imageBase64: string,
  locale: string,
): Promise<ExtractedWord[]> {
  switch (provider) {
    case 'openai':
      return callOpenAI(apiKey, imageBase64, locale);
    case 'anthropic':
      return callAnthropic(apiKey, imageBase64, locale);
    case 'gemini':
      return callGemini(apiKey, imageBase64, locale);
  }
}

async function callOpenAI(apiKey: string, imageBase64: string, locale: string): Promise<ExtractedWord[]> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
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
      reasoning_effort: 'low',
      max_completion_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const data = await res.json();
  const content: string = data.choices[0]?.message?.content ?? '[]';
  return parseJsonArray(content);
}

async function callAnthropic(apiKey: string, imageBase64: string, locale: string): Promise<ExtractedWord[]> {
  const { mediaType, base64Data } = parseDataUrl(imageBase64);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
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
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error: ${err}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
  const content: string = textBlock?.text ?? '[]';
  return parseJsonArray(content);
}

async function callGemini(apiKey: string, imageBase64: string, locale: string): Promise<ExtractedWord[]> {
  const { mediaType, base64Data } = parseDataUrl(imageBase64);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
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
        thinkingConfig: { thinkingLevel: 'low' },
      },
    }),
  });

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
  return parsed
    .filter(
      (w) => typeof w.term === 'string' && typeof w.reading === 'string' && typeof w.meaning === 'string',
    )
    .map((w) => {
      const level = typeof w.jlptLevel === 'number' && w.jlptLevel >= 1 && w.jlptLevel <= 5
        ? w.jlptLevel
        : null;
      return {
        term: w.term as string,
        reading: w.reading as string,
        meaning: w.meaning as string,
        jlptLevel: level,
      };
    });
}
