/**
 * Bulk-backfill kanji_readings.meanings / meanings_ko via the LLM.
 *
 * Resumable: only processes kanji whose readings are fully empty for EN.
 * Concurrency: N parallel LLM calls (default 10).
 *
 * Usage:
 *   bun run apps/web/scripts/backfill-kanji-meanings.ts [--limit=N] [--concurrency=N]
 */

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
const openaiApiKey = getEnvVar('NEXT_PRIVATE_OPENAI_API_KEY');

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
const sql = postgres({
  host,
  port: Number(portStr) || 5432,
  database,
  username: user,
  password,
  ssl: 'require',
  max: 20,
});

// --- CLI args ---
const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)=(.*)$/);
  if (m) args.set(m[1], m[2]);
}
const LIMIT = args.has('limit') ? Number(args.get('limit')) : Infinity;
const CONCURRENCY = args.has('concurrency') ? Number(args.get('concurrency')) : 6;

// --- Types ---
interface ReadingRow {
  id: string;
  character: string;
  reading: string;
  reading_type: 'on' | 'kun';
  position: number;
}

interface LLMEntry {
  en: string[];
  ko: string[];
}

// --- LLM call (adapted from lib/kanji/translate.ts, inlined to avoid Next runtime deps) ---
async function translateKanjiOne(
  character: string,
  readings: { type: 'on' | 'kun'; reading: string }[],
): Promise<LLMEntry[]> {
  if (readings.length === 0) return [];

  const prompt = readings
    .map((r, i) => `${i + 1}. ${r.type === 'on' ? 'On' : 'Kun'}: ${r.reading}`)
    .join('\n');

  const body = JSON.stringify({
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
      { role: 'user', content: `Kanji: ${character}\n${prompt}` },
    ],
    reasoning_effort: 'minimal',
    max_completion_tokens: 4000,
  });

  let res: Response;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    if (res.ok) break;
    if (res.status === 429 || res.status === 503) {
      const wait = 500 * Math.pow(2, attempt) + Math.random() * 400;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  }

  if (!res!.ok) {
    throw new Error(`OpenAI ${res!.status}: ${await res!.text()}`);
  }

  const res2 = res!;

  const data = await res2.json();
  const content: string = data.choices?.[0]?.message?.content ?? '[]';

  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return readings.map(() => ({ en: [], ko: [] }));

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
    return readings.map((_, i) => {
      const entry = parsed[i];
      const en = Array.isArray(entry?.en)
        ? entry.en.filter((s): s is string => typeof s === 'string' && s.length > 0)
        : [];
      const ko = Array.isArray(entry?.ko)
        ? entry.ko.filter((s): s is string => typeof s === 'string' && s.length > 0)
        : [];
      return { en, ko };
    });
  } catch {
    return readings.map(() => ({ en: [], ko: [] }));
  }
}

async function processKanji(
  character: string,
  readings: ReadingRow[],
): Promise<{ ok: boolean; character: string; filled: number }> {
  try {
    const translated = await translateKanjiOne(
      character,
      readings.map((r) => ({ type: r.reading_type, reading: r.reading })),
    );

    let filled = 0;
    for (let i = 0; i < readings.length; i++) {
      const t = translated[i] ?? { en: [], ko: [] };
      if (t.en.length === 0 && t.ko.length === 0) continue;
      await sql`
        UPDATE kanji_readings
           SET meanings = ${t.en as unknown as string[]},
               meanings_ko = ${t.ko as unknown as string[]}
         WHERE id = ${readings[i].id}
      `;
      filled += 1;
    }
    return { ok: true, character, filled };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [${character}] FAIL: ${msg}`);
    return { ok: false, character, filled: 0 };
  }
}

async function main() {
  console.log(`Selecting kanji with empty meanings (limit=${LIMIT}, concurrency=${CONCURRENCY})...`);

  const rows = await sql<ReadingRow[]>`
    SELECT id, character, reading, reading_type, position
      FROM kanji_readings
     WHERE character IN (
       SELECT character FROM kanji_readings
         WHERE cardinality(meanings) = 0 AND cardinality(meanings_ko) = 0
         GROUP BY character
     )
     ORDER BY character, reading_type, position
  `;

  const byKanji = new Map<string, ReadingRow[]>();
  for (const r of rows) {
    if (!byKanji.has(r.character)) byKanji.set(r.character, []);
    byKanji.get(r.character)!.push(r);
  }

  const tasks = Array.from(byKanji.entries()).slice(0, LIMIT === Infinity ? byKanji.size : LIMIT);
  console.log(`  ${tasks.length} kanji pending (${rows.length} total readings)`);

  let done = 0;
  let ok = 0;
  let fail = 0;
  let filled = 0;
  const startedAt = Date.now();

  const queue = [...tasks];
  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      const [character, readings] = next;
      const res = await processKanji(character, readings);
      done += 1;
      if (res.ok) ok += 1;
      else fail += 1;
      filled += res.filled;
      if (done % 25 === 0 || done === tasks.length) {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        const rate = (done / Number(elapsed)).toFixed(2);
        console.log(
          `  ${done}/${tasks.length}  ok=${ok} fail=${fail} readingsFilled=${filled}  elapsed=${elapsed}s  rate=${rate}/s`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s. ok=${ok} fail=${fail} readingsFilled=${filled}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
