interface TranslateInput {
  term: string;
  reading: string;
  meanings: string[];
}

/**
 * Translate English meanings of Japanese words to Korean using GPT.
 * Returns an array of Korean meaning arrays, one per input entry.
 */
export async function translateToKorean(
  entries: TranslateInput[],
): Promise<string[][]> {
  const apiKey = process.env.NEXT_PRIVATE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('NEXT_PRIVATE_OPENAI_API_KEY is not configured');
  }

  const prompt = entries
    .map(
      (e, i) =>
        `${i + 1}. ${e.term} (${e.reading}): ${e.meanings.join(', ')}`,
    )
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
          content: `Translate English meanings of Japanese words to concise Korean.

Rules:
- Output ONLY a valid JSON array of arrays. No text before or after the JSON.
- Each inner array = Korean translations for that numbered entry.
- Keep each translation 1-3 words. No explanations, no comments, no questions.
- Match the exact count and order of input entries.
- Use proper JSON: double quotes, no trailing commas.

Example input:
1. 食べる (たべる): to eat, to have a meal
2. 飲む (のむ): to drink

Example output:
[["먹다", "식사하다"], ["마시다"]]`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      reasoning_effort: 'low',
      max_completion_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI translation error: ${err}`);
  }

  const data = await res.json();
  const content: string = data.choices[0]?.message?.content ?? '[]';

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return entries.map(() => []);

  let jsonStr = jsonMatch[0];

  // Fix truncated JSON from reasoning models
  try {
    JSON.parse(jsonStr);
  } catch {
    jsonStr = jsonStr.replace(/,\s*$/, '');
    const open = (jsonStr.match(/\[/g) || []).length;
    const close = (jsonStr.match(/\]/g) || []).length;
    if (open > close) {
      jsonStr = jsonStr.replace(/,?\s*\[?[^\[\]]*$/, '');
      const o2 = (jsonStr.match(/\[/g) || []).length;
      const c2 = (jsonStr.match(/\]/g) || []).length;
      for (let k = 0; k < o2 - c2; k++) jsonStr += ']';
    }
  }

  try {
    const parsed = JSON.parse(jsonStr) as string[][];
    return entries.map((_, i) => {
      const result = parsed[i];
      if (!Array.isArray(result)) return [];
      return result.filter((s): s is string => typeof s === 'string');
    });
  } catch {
    return entries.map(() => []);
  }
}
