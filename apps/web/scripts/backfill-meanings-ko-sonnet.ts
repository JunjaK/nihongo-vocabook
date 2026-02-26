import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
const anthropicApiKey = getEnvVar('ANTHROPIC_API_KEY');

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

const BATCH_SIZE = 50; // Sonnet handles larger batches reliably
const LIMIT = 1000;

interface DictRow {
  term: string;
  reading: string;
  meanings: string[];
}

async function translateBatch(entries: DictRow[]): Promise<string[][]> {
  const prompt = entries
    .map((e, i) => `${i + 1}. ${e.term} (${e.reading}): ${e.meanings.join(', ')}`)
    .join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
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
[["먹다", "식사하다"], ["마시다"]]

Now translate these:
${prompt}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error: ${err}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: { type: string }) => b.type === 'text');
  const content: string = textBlock?.text ?? '[]';

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('  [SONNET] No JSON array found in response');
    console.error('  [SONNET] Raw:', content.slice(0, 300));
    return entries.map(() => []);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as string[][];
    return entries.map((_, i) => {
      const result = parsed[i];
      if (!Array.isArray(result)) return [];
      return result.filter((s): s is string => typeof s === 'string');
    });
  } catch (e) {
    console.error('  [SONNET] JSON parse failed:', (e as Error).message);
    console.error('  [SONNET] Content:', content.slice(0, 500));
    return entries.map(() => []);
  }
}

async function run() {
  const rows = await sql<DictRow[]>`
    SELECT term, reading, meanings
    FROM dictionary_entries
    WHERE (meanings_ko IS NULL OR meanings_ko = '{}')
    ORDER BY term
    LIMIT ${LIMIT}
  `;

  console.log(`[SONNET] Found ${rows.length} entries to translate (limit: ${LIMIT})`);

  if (rows.length === 0) {
    await sql.end();
    return;
  }

  let translated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    console.log(`\n[SONNET] Batch ${Math.floor(i / BATCH_SIZE) + 1}: translating ${batch.length} entries...`);

    try {
      const results = await translateBatch(batch);

      for (let j = 0; j < batch.length; j++) {
        const ko = results[j];
        if (ko && ko.length > 0) {
          await sql`
            UPDATE dictionary_entries
            SET meanings_ko = ${ko}
            WHERE term = ${batch[j].term} AND reading = ${batch[j].reading}
              AND (meanings_ko IS NULL OR meanings_ko = '{}')
          `;
          translated++;
        } else {
          failed++;
        }
      }

      console.log(`  [SONNET] Done. Total: ${translated} translated, ${failed} failed`);
    } catch (err) {
      console.error(`  [SONNET] Batch failed:`, err instanceof Error ? err.message : err);
      failed += batch.length;
    }

    // Rate limit
    if (i + BATCH_SIZE < rows.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n[SONNET] Complete. Translated: ${translated}, Failed: ${failed}`);
  await sql.end();
}

run();
