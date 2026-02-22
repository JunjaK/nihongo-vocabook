import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface DictionaryRow {
  term: string;
  reading: string;
  meanings: string[];
  parts_of_speech: string[];
  jlpt_level: number | null;
}

interface JishoResult {
  slug: string;
  japanese: { word?: string; reading: string }[];
  senses: {
    english_definitions: string[];
    parts_of_speech: string[];
  }[];
  jlpt: string[];
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

const MAX_TERMS = 200;

export async function POST(request: NextRequest) {
  let body: { terms?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const { terms } = body;

  if (!Array.isArray(terms) || terms.length === 0) {
    return NextResponse.json(
      { error: 'Missing or empty "terms" array' },
      { status: 400 },
    );
  }

  if (terms.length > MAX_TERMS) {
    return NextResponse.json(
      { error: `Too many terms (max ${MAX_TERMS})` },
      { status: 400 },
    );
  }

  const uniqueTerms = [...new Set(terms)];
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from('dictionary_entries')
    .select('term, reading, meanings, parts_of_speech, jlpt_level')
    .in('term', uniqueTerms);

  if (error) {
    return NextResponse.json(
      { error: `Database error: ${error.message}` },
      { status: 500 },
    );
  }

  const found: Record<string, JishoResult[]> = {};
  for (const row of rows ?? []) {
    const mapped = mapRowToJisho(row);
    if (!found[row.term]) {
      found[row.term] = [];
    }
    found[row.term].push(mapped);
  }

  const missing = uniqueTerms.filter((term) => !found[term]);

  return NextResponse.json({ found, missing });
}
