import { NextResponse, after, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createLogger } from '@/lib/logger';
import {
  createAnonymousRateLimiter,
  shouldBlockAnonymousBot,
} from '@/lib/api/rate-limit';
import { KANJI_REGEX } from '@/lib/ruby';
import {
  translateKanjiReadings,
  type KanjiReadingInput,
} from '@/lib/kanji/translate';
import type { Kanji, KanjiReadingType } from '@/types/kanji';

interface KanjiRow {
  character: string;
  stroke_count: number | null;
  jlpt_level: number | null;
  grade: number | null;
  frequency: number | null;
  kanji_readings: {
    id: string;
    reading: string;
    reading_type: KanjiReadingType;
    meanings: string[];
    meanings_ko: string[];
    position: number;
  }[];
}

const logger = createLogger('api/kanji');
const isAnonymousRateLimited = createAnonymousRateLimiter();

function isSingleKanji(input: string): boolean {
  if (!input) return false;
  const chars = Array.from(input);
  if (chars.length !== 1) return false;
  return KANJI_REGEX.test(chars[0]);
}

async function backfillMeanings(
  character: string,
  readings: KanjiReadingInput[],
): Promise<void> {
  try {
    const translated = await translateKanjiReadings(character, readings);
    const admin = createAdminClient();

    for (const t of translated) {
      if (t.meaningsEn.length === 0 && t.meaningsKo.length === 0) continue;
      const { error } = await admin
        .from('kanji_readings')
        .update({
          meanings: t.meaningsEn,
          meanings_ko: t.meaningsKo,
        })
        .eq('character', character)
        .eq('reading', t.reading)
        .eq('reading_type', t.type);
      if (error) logger.error('kanji_readings update failed', error.message);
    }
  } catch (err) {
    logger.warn(
      'Kanji translation failed',
      err instanceof Error ? err.message : err,
    );
  }
}

export async function GET(request: NextRequest) {
  const c = request.nextUrl.searchParams.get('c') ?? '';
  const locale = request.nextUrl.searchParams.get('locale') ?? 'en';

  if (!isSingleKanji(c)) {
    return NextResponse.json(
      { error: 'Invalid "c" — must be a single kanji character' },
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

  const { data: row, error } = await supabase
    .from('kanjis')
    .select(
      `
      character,
      stroke_count,
      jlpt_level,
      grade,
      frequency,
      kanji_readings (
        id, reading, reading_type, meanings, meanings_ko, position
      )
    `,
    )
    .eq('character', c)
    .maybeSingle<KanjiRow>();

  if (error) {
    logger.error('kanjis select failed', error.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 502 });
  }

  if (!row) {
    return NextResponse.json({ data: null }, { status: 404 });
  }

  const sortedReadings = [...row.kanji_readings].sort((a, b) => {
    if (a.reading_type !== b.reading_type) {
      return a.reading_type === 'on' ? -1 : 1;
    }
    return a.position - b.position;
  });

  // Identify readings that still need English meanings — trigger fire-and-forget LLM backfill.
  const needBackfill = sortedReadings.filter(
    (r) =>
      r.meanings.length === 0 ||
      (isAuthenticated && r.meanings_ko.length === 0),
  );

  if (needBackfill.length > 0) {
    const inputs: KanjiReadingInput[] = sortedReadings.map((r) => ({
      type: r.reading_type,
      reading: r.reading,
    }));
    after(() => backfillMeanings(row.character, inputs));
  }

  const showKo = isAuthenticated && locale === 'ko';

  const data: Kanji = {
    character: row.character,
    strokeCount: row.stroke_count,
    jlptLevel: row.jlpt_level,
    grade: row.grade,
    frequency: row.frequency,
    readings: sortedReadings.map((r) => ({
      type: r.reading_type,
      reading: r.reading,
      meanings: r.meanings,
      meaningsKo: showKo && r.meanings_ko.length > 0 ? r.meanings_ko : undefined,
    })),
  };

  return NextResponse.json({ data });
}
