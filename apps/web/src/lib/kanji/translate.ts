export interface KanjiReadingInput {
  type: 'on' | 'kun';
  reading: string;
}

export interface KanjiReadingMeanings {
  type: 'on' | 'kun';
  reading: string;
  meaningsEn: string[];
  meaningsKo: string[];
}

/**
 * Ask the LLM for reading-specific meanings (English + Korean) for every
 * reading of a single kanji. One call covers both locales to avoid a second
 * round-trip.
 */
export async function translateKanjiReadings(
  character: string,
  readings: KanjiReadingInput[],
): Promise<KanjiReadingMeanings[]> {
  const apiKey = process.env.NEXT_PRIVATE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('NEXT_PRIVATE_OPENAI_API_KEY is not configured');
  }

  if (readings.length === 0) return [];

  const prompt = readings
    .map((r, i) => `${i + 1}. ${r.type === 'on' ? 'On' : 'Kun'}: ${r.reading}`)
    .join('\n');

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
          role: 'system',
          content: `You are a Japanese kanji dictionary. Given a kanji and its readings (on/kun), return reading-specific meanings in English and Korean.

Rules:
- Output ONLY a valid JSON array. No text before or after the JSON.
- Each element corresponds to the numbered input reading, in the same order.
- Shape: {"en":[...],"ko":[...]}
- Each array contains 1–3 concise glosses (1–3 words each). Glosses must be MEANINGS ONLY — never echo the reading, never prepend the reading, never include dot notation.
- Korean glosses are Korean (hangul). English glosses are English. Do not mix scripts inside a single gloss.
- Glosses must match THAT specific reading (not the kanji as a whole). If a reading is uncommon/archaic and a precise meaning is unclear, return an empty array for that entry instead of guessing.
- Kun readings use dot notation (e.g. "い.きる") where the dot marks the okurigana boundary. Treat the whole token as the reading when looking up its meaning; do NOT include the dot token in the output.
- No explanations, no comments, no questions. Use proper JSON: double quotes, no trailing commas.

Example input (kanji 生):
1. On: セイ
2. On: ショウ
3. Kun: い.きる
4. Kun: う.まれる

Example output:
[{"en":["life","birth"],"ko":["삶","태어남"]},{"en":["life","nature"],"ko":["생","본성"]},{"en":["to live"],"ko":["살다"]},{"en":["to be born"],"ko":["태어나다"]}]`,
        },
        {
          role: 'user',
          content: `Kanji: ${character}\n${prompt}`,
        },
      ],
      reasoning_effort: 'minimal',
      max_completion_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI kanji translation error: ${err}`);
  }

  const data = await res.json();
  const content: string = data.choices[0]?.message?.content ?? '[]';

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return readings.map((r) => ({ ...r, meaningsEn: [], meaningsKo: [] }));

  let jsonStr = jsonMatch[0];

  try {
    JSON.parse(jsonStr);
  } catch {
    jsonStr = jsonStr.replace(/,\s*$/, '');
    const open = (jsonStr.match(/\[/g) || []).length;
    const close = (jsonStr.match(/\]/g) || []).length;
    if (open > close) {
      jsonStr = jsonStr.replace(/,?\s*\{?[^{}]*$/, '');
      const o2 = (jsonStr.match(/\[/g) || []).length;
      const c2 = (jsonStr.match(/\]/g) || []).length;
      for (let k = 0; k < o2 - c2; k++) jsonStr += ']';
    }
  }

  try {
    const parsed = JSON.parse(jsonStr) as { en?: string[]; ko?: string[] }[];
    return readings.map((r, i) => {
      const entry = parsed[i];
      const en = Array.isArray(entry?.en)
        ? entry.en.filter((s): s is string => typeof s === 'string')
        : [];
      const ko = Array.isArray(entry?.ko)
        ? entry.ko.filter((s): s is string => typeof s === 'string')
        : [];
      return { type: r.type, reading: r.reading, meaningsEn: en, meaningsKo: ko };
    });
  } catch {
    return readings.map((r) => ({ ...r, meaningsEn: [], meaningsKo: [] }));
  }
}
