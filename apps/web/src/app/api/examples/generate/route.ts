import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api/examples/generate');

const SYSTEM_PROMPT = `You are a Japanese language expert generating natural example sentences.

Output ONLY a JSON array. No prose before or after.

Format — exactly 2 objects:
[
  {"sentence_ja": "...", "sentence_reading": "...", "sentence_meaning": "..."},
  {"sentence_ja": "...", "sentence_reading": "...", "sentence_meaning": "..."}
]

Rules for each sentence:
- sentence_ja: natural, everyday Japanese using the target word. JLPT N5–N3 grammar unless the target itself is advanced.
- sentence_reading: full hiragana reading of the sentence (furigana for every kanji).
- sentence_meaning: natural Korean translation (not word-by-word).
- 10–25 characters per Japanese sentence.
- Demonstrate two different usages/contexts of the target word.
- Conjugate the target word naturally — do not leave it in dictionary form.`;

interface GeneratedExample {
  sentence_ja: string;
  sentence_reading: string;
  sentence_meaning: string;
}

async function callClaudeForExamples(
  apiKey: string,
  term: string,
  reading: string,
  meaning: string,
): Promise<GeneratedExample[]> {
  const userPrompt = `Target word: ${term} (${reading}) — meaning: ${meaning}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
  const content: string = textBlock?.text ?? '[]';

  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];

  const parsed = JSON.parse(match[0]) as GeneratedExample[];
  return parsed
    .filter(
      (p): p is GeneratedExample =>
        typeof p?.sentence_ja === 'string' &&
        typeof p?.sentence_reading === 'string' &&
        typeof p?.sentence_meaning === 'string',
    )
    .slice(0, 2);
}

export async function POST(request: NextRequest) {
  let body: { dictionaryEntryId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { dictionaryEntryId } = body;
  if (!dictionaryEntryId || typeof dictionaryEntryId !== 'string') {
    return NextResponse.json(
      { error: 'Missing dictionaryEntryId' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { count: existing } = await supabase
    .from('word_examples')
    .select('id', { count: 'exact', head: true })
    .eq('dictionary_entry_id', dictionaryEntryId);
  if ((existing ?? 0) > 0) {
    return NextResponse.json({ skipped: true, existing });
  }

  const { data: entry, error: entryError } = await supabase
    .from('dictionary_entries')
    .select('id, term, reading, meanings, meanings_ko')
    .eq('id', dictionaryEntryId)
    .maybeSingle();
  if (entryError || !entry) {
    return NextResponse.json({ error: 'Dictionary entry not found' }, { status: 404 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.error('ANTHROPIC_API_KEY not configured');
    return NextResponse.json({ error: 'LLM_UNAVAILABLE' }, { status: 503 });
  }

  const typedEntry = entry as {
    id: string;
    term: string;
    reading: string;
    meanings: string[];
    meanings_ko: string[] | null;
  };

  const meaningForPrompt =
    typedEntry.meanings_ko && typedEntry.meanings_ko.length > 0
      ? typedEntry.meanings_ko.join(', ')
      : typedEntry.meanings.join(', ');

  let examples: GeneratedExample[];
  try {
    examples = await callClaudeForExamples(
      apiKey,
      typedEntry.term,
      typedEntry.reading,
      meaningForPrompt,
    );
  } catch (err) {
    logger.warn('Claude example generation failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'LLM_FAILED' }, { status: 502 });
  }

  if (examples.length === 0) {
    return NextResponse.json({ error: 'NO_OUTPUT' }, { status: 502 });
  }

  const rows = examples.map((ex) => ({
    dictionary_entry_id: typedEntry.id,
    sentence_ja: ex.sentence_ja,
    sentence_reading: ex.sentence_reading,
    sentence_meaning: ex.sentence_meaning,
    source: 'claude',
  }));

  const { error: insertError } = await supabase
    .from('word_examples')
    .insert(rows);
  if (insertError) {
    // Uniqueness collision means another generator already wrote — treat as success.
    if (insertError.code === '23505') {
      return NextResponse.json({ skipped: true, reason: 'DUPLICATE' });
    }
    logger.error('Insert failed', insertError.message);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ generated: rows.length, dictionaryEntryId: typedEntry.id });
}
