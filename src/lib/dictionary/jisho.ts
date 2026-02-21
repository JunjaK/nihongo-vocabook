import type { DictionaryEntry } from '@/types/word';

interface JishoApiResponse {
  data: JishoResult[];
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

function mapResult(result: JishoResult): DictionaryEntry {
  return {
    slug: result.slug,
    japanese: result.japanese.map((j) => ({
      word: j.word,
      reading: j.reading,
    })),
    senses: result.senses.map((s) => ({
      englishDefinitions: s.english_definitions,
      partsOfSpeech: s.parts_of_speech,
    })),
    jlptLevels: result.jlpt,
  };
}

export async function searchDictionary(
  query: string,
): Promise<DictionaryEntry[]> {
  const res = await fetch(
    `/api/dictionary?q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) throw new Error('Dictionary search failed');
  const data: JishoApiResponse = await res.json();
  return data.data.map(mapResult);
}
