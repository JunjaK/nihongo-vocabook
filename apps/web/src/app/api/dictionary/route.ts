import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { translateToKorean } from '@/lib/dictionary/translate';
import { createLogger } from '@/lib/logger';
import {
  createAnonymousRateLimiter,
  shouldBlockAnonymousBot,
} from '@/lib/api/rate-limit';

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

const SEARCH_RESULT_LIMIT = 10;
const logger = createLogger('api/dictionary');
const isAnonymousRateLimited = createAnonymousRateLimiter();

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

/**
 * Hide Korean definitions from dictionary response payload.
 */
function hideKoreanDefinitions(results: JishoResult[]): JishoResult[] {
  return results.map((result) => ({
    ...result,
    senses: result.senses.map((sense) => ({
      ...sense,
      korean_definitions: undefined,
    })),
  }));
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

function applyKoreanDefinitionsToResults(
  results: JishoResult[],
  translated: string[][],
): void {
  for (let i = 0; i < results.length; i++) {
    const ko = translated[i];
    if (!ko || ko.length === 0) continue;
    if (!results[i].senses || results[i].senses.length === 0) continue;
    results[i].senses[0].korean_definitions = ko;
  }
}

function mapJishoResultToRow(result: JishoResult): DictionaryRow {
  const jp = result.japanese[0];
  const sense = result.senses[0];
  const jlptMatch = result.jlpt[0]?.match(/\d/);

  return {
    term: jp?.word ?? jp?.reading ?? result.slug,
    reading: jp?.reading ?? '',
    meanings: sense?.english_definitions?.slice(0, 5) ?? [],
    meanings_ko: sense?.korean_definitions?.slice(0, 5) ?? [],
    parts_of_speech: sense?.parts_of_speech ?? [],
    jlpt_level: jlptMatch ? Number(jlptMatch[0]) : null,
  };
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
            if (error) {
              logger.error('Failed to update meanings_ko', error.message);
            }
          });
      }
    }
  } catch (err) {
    // GPT translation failure — non-blocking, return English-only
    logger.warn('Korean translation failed', err instanceof Error ? err.message : err);
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(user);

  if (!isAuthenticated) {
    const botBlock = shouldBlockAnonymousBot(request);
    if (botBlock) {
      return NextResponse.json({ error: botBlock.error }, { status: botBlock.status });
    }

    if (isAnonymousRateLimited(request)) {
      return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    }
  }

  // 1. Try local DB first (search both term and reading)
  const { data: rows } = await supabase
    .from('dictionary_entries')
    .select('term, reading, meanings, meanings_ko, parts_of_speech, jlpt_level')
    .or(`term.eq.${query},reading.eq.${query}`)
    .limit(SEARCH_RESULT_LIMIT);

  if (rows && rows.length > 0) {
    // Backfill missing Korean meanings (auth only — requires LLM call).
    if (isAuthenticated) {
      await translateAndUpdateRows(supabase, rows);
    }

    const mapped = rows.map(mapRowToJisho);
    return NextResponse.json({
      data: locale === 'ko' ? mapped : hideKoreanDefinitions(mapped),
    });
  }

  // 2. Jisho fallback with retry
  try {
    const results = (await fetchJishoWithRetry(query)).slice(0, SEARCH_RESULT_LIMIT);

    // 3. Translate before responding so Korean meanings are available immediately
    if (results.length > 0) {
      if (isAuthenticated) {
        try {
          const translated = await translateToKorean(
            results.map((result) => {
              const row = mapJishoResultToRow(result);
              return {
                term: row.term,
                reading: row.reading,
                meanings: row.meanings,
              };
            }));
          applyKoreanDefinitionsToResults(results, translated);
        } catch (err) {
          // Non-blocking — translation failure falls back to English-only
          logger.warn(
            'Failed to translate Jisho results',
            err instanceof Error ? err.message : err,
          );
        }
      }

      const entries = results.map(mapJishoResultToRow);

      // 4. Fire-and-forget dictionary cache (regardless of auth)
      supabase
        .from('dictionary_entries')
        .upsert(entries, { onConflict: 'term,reading' })
        .then(({ error }) => {
          if (error) logger.error('Dictionary cache error', error.message);
        });

      return NextResponse.json({
        data: locale === 'ko' ? results : hideKoreanDefinitions(results),
      });
    }

    return NextResponse.json({
      data: locale === 'ko' ? results : hideKoreanDefinitions(results),
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Jisho API request failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
