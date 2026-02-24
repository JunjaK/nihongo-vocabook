import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { translateToKorean } from '@/lib/dictionary/translate';

interface JishoResult {
  slug: string;
  japanese: { word?: string; reading: string }[];
  senses: {
    english_definitions: string[];
    korean_definitions?: string[];
    parts_of_speech: string[];
  }[];
  jlpt: string[];
}

interface DictionaryRow {
  term: string;
  reading: string;
  meanings: string[];
  meanings_ko: string[];
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
        korean_definitions:
          row.meanings_ko && row.meanings_ko.length > 0
            ? row.meanings_ko
            : undefined,
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

async function translateAndUpdateRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: DictionaryRow[],
): Promise<void> {
  const toTranslate = rows.filter(
    (r) => !r.meanings_ko || r.meanings_ko.length === 0,
  );
  if (toTranslate.length === 0) return;

  try {
    const translated = await translateToKorean(
      toTranslate.map((r) => ({
        term: r.term,
        reading: r.reading,
        meanings: r.meanings,
      })),
    );

    for (let i = 0; i < toTranslate.length; i++) {
      const ko = translated[i];
      if (ko && ko.length > 0) {
        toTranslate[i].meanings_ko = ko;
        // Fire-and-forget DB update
        supabase
          .from('dictionary_entries')
          .update({ meanings_ko: ko })
          .eq('term', toTranslate[i].term)
          .eq('reading', toTranslate[i].reading)
          .then(({ error }) => {
            if (error)
              console.error('Failed to update meanings_ko:', error.message);
          });
      }
    }
  } catch (err) {
    // GPT translation failure — non-blocking, return English-only
    console.error(
      'GPT translation failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q');
  const locale = request.nextUrl.searchParams.get('locale') ?? 'en';

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
    .select('term, reading, meanings, meanings_ko, parts_of_speech, jlpt_level')
    .eq('term', query)
    .limit(10);

  if (rows && rows.length > 0) {
    // If locale=ko, backfill missing Korean meanings on-demand
    if (locale === 'ko') {
      await translateAndUpdateRows(supabase, rows);
    }

    return NextResponse.json({
      data: rows.map(mapRowToJisho),
    });
  }

  // 2. Jisho fallback with retry
  try {
    const results = await fetchJishoWithRetry(query);

    // 3. Cache top 5 results
    if (results.length > 0) {
      const entries = results.slice(0, 5).map((r) => {
        const jp = r.japanese[0];
        const sense = r.senses[0];
        const jlptMatch = r.jlpt[0]?.match(/\d/);
        return {
          term: jp?.word ?? jp?.reading ?? r.slug,
          reading: jp?.reading ?? '',
          meanings: sense?.english_definitions?.slice(0, 5) ?? [],
          meanings_ko: [] as string[],
          parts_of_speech: sense?.parts_of_speech ?? [],
          jlpt_level: jlptMatch ? Number(jlptMatch[0]) : null,
          source: 'jisho',
        };
      });

      // If locale=ko, translate before caching
      if (locale === 'ko') {
        try {
          const translated = await translateToKorean(
            entries.map((e) => ({
              term: e.term,
              reading: e.reading,
              meanings: e.meanings,
            })),
          );
          for (let i = 0; i < entries.length; i++) {
            if (translated[i] && translated[i].length > 0) {
              entries[i].meanings_ko = translated[i];
            }
          }
        } catch {
          // Non-blocking — cache without Korean
        }
      }

      // Fire-and-forget upsert (strip source for type safety, add back)
      supabase
        .from('dictionary_entries')
        .upsert(entries, { onConflict: 'term,reading', ignoreDuplicates: true })
        .then(({ error }) => {
          if (error) console.error('Dictionary cache error:', error.message);
        });

      // Return cached entries as JishoResult (includes korean_definitions)
      return NextResponse.json({
        data: entries.map((e) => mapRowToJisho(e as DictionaryRow)),
      });
    }

    return NextResponse.json({ data: results });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Jisho API request failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
