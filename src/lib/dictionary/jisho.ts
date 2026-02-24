import type { DictionaryEntry } from '@/types/word';

interface JishoApiResponse {
  data: JishoResult[];
}

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

function mapResult(result: JishoResult): DictionaryEntry {
  return {
    slug: result.slug,
    japanese: result.japanese.map((j) => ({
      word: j.word,
      reading: j.reading,
    })),
    senses: result.senses.map((s) => ({
      englishDefinitions: s.english_definitions,
      koreanDefinitions: s.korean_definitions,
      partsOfSpeech: s.parts_of_speech,
    })),
    jlptLevels: result.jlpt,
  };
}

export async function searchDictionary(
  query: string,
  locale?: string,
): Promise<DictionaryEntry[]> {
  const params = new URLSearchParams({ q: query });
  if (locale) params.set('locale', locale);

  const res = await fetch(`/api/dictionary?${params}`);
  if (!res.ok) throw new Error('Dictionary search failed');
  const data: JishoApiResponse = await res.json();
  return data.data.map(mapResult);
}

interface BatchResponse {
  found: Record<string, JishoResult[]>;
  missing: string[];
}

export async function searchDictionaryBatch(
  terms: string[],
  locale?: string,
): Promise<{ found: Map<string, DictionaryEntry[]>; missing: string[] }> {
  const res = await fetch('/api/dictionary/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terms, locale }),
  });
  if (!res.ok) throw new Error('Batch dictionary search failed');

  const data: BatchResponse = await res.json();

  const found = new Map<string, DictionaryEntry[]>();
  for (const [term, results] of Object.entries(data.found)) {
    found.set(term, results.map(mapResult));
  }

  return { found, missing: data.missing };
}
