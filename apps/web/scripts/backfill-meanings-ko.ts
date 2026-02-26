import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local manually
const envPath = join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');

function getEnvVar(name: string): string {
  const line = envContent.split('\n').find((l) => l.startsWith(`${name}=`));
  if (!line) {
    console.error(`${name} not found in .env.local`);
    process.exit(1);
  }
  return line.slice(name.length + 1).trim();
}

const dbUrl = getEnvVar('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION');
const openaiApiKey = getEnvVar('NEXT_PRIVATE_OPENAI_API_KEY');

// Parse DB URL
const schemeEnd = dbUrl.indexOf('://') + 3;
const rest = dbUrl.slice(schemeEnd);
const lastAt = rest.lastIndexOf('@');
const credentials = rest.slice(0, lastAt);
const hostPart = rest.slice(lastAt + 1);
const colonIdx = credentials.indexOf(':');
const user = credentials.slice(0, colonIdx);
const password = credentials.slice(colonIdx + 1);
const [hostPort, database] = hostPart.split('/');
const [host, portStr] = hostPort.split(':');
const port = Number(portStr) || 5432;

const sql = postgres({ host, port, database, username: user, password, ssl: 'require' });

const BATCH_SIZE = 10;

interface DictRow {
  term: string;
  reading: string;
  meanings: string[];
}

async function translateBatch(
  entries: DictRow[],
): Promise<string[][]> {
  const prompt = entries
    .map((e, i) => `${i + 1}. ${e.term} (${e.reading}): ${e.meanings.join(', ')}`)
    .join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
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
        { role: 'user', content: prompt },
      ],
      reasoning_effort: 'low',
      max_completion_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${err}`);
  }

  const data = await res.json();
  const finishReason = data.choices[0]?.finish_reason;
  const content: string = data.choices[0]?.message?.content ?? '[]';
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('  [DEBUG] No JSON array found. finish_reason:', finishReason);
    console.error('  [DEBUG] Raw content:', content.slice(0, 300));
    return entries.map(() => []);
  }

  let jsonStr = jsonMatch[0];

  // Fix truncated JSON: close any open brackets
  try {
    JSON.parse(jsonStr);
  } catch {
    // Try fixing: remove trailing incomplete entry, close brackets
    // e.g. [["a"], ["b"   →  [["a"], ["b"]]
    jsonStr = jsonStr.replace(/,\s*$/, ''); // trailing comma
    const openBrackets = (jsonStr.match(/\[/g) || []).length;
    const closeBrackets = (jsonStr.match(/\]/g) || []).length;
    const missing = openBrackets - closeBrackets;
    if (missing > 0) {
      // Remove last incomplete element if it's not closed
      jsonStr = jsonStr.replace(/,?\s*\[?[^\[\]]*$/, '');
      const open2 = (jsonStr.match(/\[/g) || []).length;
      const close2 = (jsonStr.match(/\]/g) || []).length;
      for (let k = 0; k < open2 - close2; k++) jsonStr += ']';
    }
  }

  try {
    const parsed = JSON.parse(jsonStr) as string[][];
    return entries.map((_, i) => {
      const result = parsed[i];
      if (!Array.isArray(result)) return [];
      return result.filter((s): s is string => typeof s === 'string');
    });
  } catch (e) {
    console.error('  [DEBUG] JSON parse failed after fix. finish_reason:', finishReason);
    console.error('  [DEBUG] Error:', (e as Error).message);
    console.error('  [DEBUG] Last 200 chars:', jsonStr.slice(-200));
    return entries.map(() => []);
  }
}

async function run() {
  // Find all entries without Korean meanings
  const rows = await sql<DictRow[]>`
    SELECT term, reading, meanings
    FROM dictionary_entries
    WHERE (meanings_ko IS NULL OR meanings_ko = '{}')
    ORDER BY term
  `;

  console.log(`Found ${rows.length} entries to backfill.`);

  if (rows.length === 0) {
    await sql.end();
    return;
  }

  let translated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: translating ${batch.length} entries...`);

    try {
      const results = await translateBatch(batch);

      for (let j = 0; j < batch.length; j++) {
        const ko = results[j];
        if (ko && ko.length > 0) {
          await sql`
            UPDATE dictionary_entries
            SET meanings_ko = ${ko}
            WHERE term = ${batch[j].term} AND reading = ${batch[j].reading}
          `;
          translated++;
        } else {
          failed++;
        }
      }

      console.log(`  Done. Total translated: ${translated}, failed: ${failed}`);
    } catch (err) {
      console.error(`  Batch failed:`, err instanceof Error ? err.message : err);
      failed += batch.length;
    }

    // Rate limit: wait between batches
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\nBackfill complete. Translated: ${translated}, Failed: ${failed}`);
  await sql.end();
}

run();
