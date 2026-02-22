import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface JishoResult {
  slug: string;
  japanese: { word?: string; reading: string }[];
  senses: {
    english_definitions: string[];
    parts_of_speech: string[];
  }[];
  jlpt: string[];
}

interface DictionaryRow {
  term: string;
  reading: string;
  meanings: string[];
  parts_of_speech: string[];
  jlpt_level: number | null;
}

function mapRowToJisho(row: DictionaryRow): JishoResult {
  return {
    slug: row.term,
    japanese: [{ word: row.term, reading: row.reading }],
    senses: [
      {
        english_definitions: row.meanings,
        parts_of_speech: row.parts_of_speech,
      },
    ],
    jlpt: row.jlpt_level ? [`jlpt-n${row.jlpt_level}`] : [],
  };
}

async function fetchJishoWithRetry(
  query: string,
  maxRetries = 3,
): Promise<JishoResult[]> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(
      `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'nihongo-vocabook/1.0' } },
    );

    if (res.ok) {
      const data = await res.json();
      return data.data;
    }

    if (res.status === 429 || res.status === 503) {
      const backoff = Math.pow(2, attempt) * 1000;
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }

    throw new Error(`Jisho API error: ${res.status}`);
  }

  throw new Error('Jisho API: max retries exceeded');
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');

  if (!query) {
    return NextResponse.json(
      { error: 'Missing query parameter "q"' },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // 1. Try local DB first
  const { data: rows } = await supabase
    .from('dictionary_entries')
    .select('term, reading, meanings, parts_of_speech, jlpt_level')
    .eq('term', query)
    .limit(10);

  if (rows && rows.length > 0) {
    return NextResponse.json({
      data: rows.map(mapRowToJisho),
    });
  }

  // 2. Jisho fallback with retry
  try {
    const results = await fetchJishoWithRetry(query);

    // 3. Cache top 5 results (fire-and-forget)
    if (results.length > 0) {
      const entries = results.slice(0, 5).map((r) => {
        const jp = r.japanese[0];
        const sense = r.senses[0];
        const jlptMatch = r.jlpt[0]?.match(/\d/);
        return {
          term: jp?.word ?? jp?.reading ?? r.slug,
          reading: jp?.reading ?? '',
          meanings: sense?.english_definitions?.slice(0, 5) ?? [],
          parts_of_speech: sense?.parts_of_speech ?? [],
          jlpt_level: jlptMatch ? Number(jlptMatch[0]) : null,
          source: 'jisho',
        };
      });

      supabase
        .from('dictionary_entries')
        .upsert(entries, { onConflict: 'term,reading', ignoreDuplicates: true })
        .then(({ error }) => {
          if (error) console.error('Dictionary cache error:', error.message);
        });
    }

    return NextResponse.json({ data: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Jisho API request failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
