/**
 * Insert agent-authored example sentences and send a summary email.
 *
 * Input: JSON file path as argv[2], shape:
 *   [
 *     {
 *       "dictionary_entry_id": "uuid",
 *       "term": "...",
 *       "reading": "...",
 *       "priority": "A" | "B",
 *       "examples": [
 *         { "sentence_ja": "...", "sentence_reading": "...", "sentence_meaning": "..." },
 *         { ... }
 *       ]
 *     },
 *     ...
 *   ]
 *
 * Behavior:
 *   - Idempotent INSERT (ON CONFLICT DO NOTHING) into word_examples with source='claude-routine'
 *   - Tracks inserted vs duplicate vs invalid
 *   - Reads backlog counts after the run
 *   - Sends Resend mail if RESEND_API_KEY present (skips when nothing happened)
 *
 * Env:
 *   NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION
 *   RESEND_API_KEY (optional)
 *   MAIL_TO (default haring157@gmail.com)
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL = join(SCRIPT_DIR, '..', '..', '.env.local');

function readFromEnvLocal(name: string): string | undefined {
  try {
    const content = readFileSync(ENV_LOCAL, 'utf-8');
    const line = content.split('\n').find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim();
  } catch {
    /* ignore — file may not exist in remote env */
  }
  return undefined;
}

function envOrThrow(name: string): string {
  const fromFile = readFromEnvLocal(name);
  if (fromFile) return fromFile;
  if (process.env[name]) return process.env[name]!;
  throw new Error(`${name} is not set`);
}

function envOrUndefined(name: string): string | undefined {
  const fromFile = readFromEnvLocal(name);
  if (fromFile) return fromFile;
  if (process.env[name]) return process.env[name];
  return undefined;
}

const DB_URL = envOrThrow('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION');
const RESEND_KEY = envOrUndefined('RESEND_API_KEY');
const MAIL_TO = envOrUndefined('MAIL_TO') ?? 'haring157@gmail.com';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: bun insert-examples.ts <results.json>');
  process.exit(2);
}

interface ExamplePayload {
  sentence_ja: string;
  sentence_reading: string;
  sentence_meaning: string;
}

interface EntryPayload {
  dictionary_entry_id: string;
  term: string;
  reading: string;
  priority: 'A' | 'B';
  examples: ExamplePayload[];
}

const raw = readFileSync(inputPath, 'utf-8');
const entries: EntryPayload[] = JSON.parse(raw);

const s = DB_URL.indexOf('://') + 3;
const r = DB_URL.slice(s);
const a = r.lastIndexOf('@');
const c = r.slice(0, a);
const h = r.slice(a + 1);
const ci = c.indexOf(':');
const sql = postgres({
  host: h.split('/')[0].split(':')[0],
  port: Number(h.split('/')[0].split(':')[1]) || 5432,
  database: h.split('/')[1],
  username: c.slice(0, ci),
  password: c.slice(ci + 1),
  ssl: 'require',
});

function isValidExample(ex: unknown): ex is ExamplePayload {
  if (typeof ex !== 'object' || ex === null) return false;
  const e = ex as Record<string, unknown>;
  return (
    typeof e.sentence_ja === 'string' &&
    typeof e.sentence_reading === 'string' &&
    typeof e.sentence_meaning === 'string' &&
    e.sentence_ja.length > 0 &&
    e.sentence_reading.length > 0 &&
    e.sentence_meaning.length > 0
  );
}

interface Stats {
  startedAt: string;
  durationSec: number;
  priorityA: number;
  priorityB: number;
  examplesInserted: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  backlogA: number;
  backlogB: number;
  sample: { term: string; reading: string; sentence_ja: string; sentence_meaning: string }[];
}

const stats: Stats = {
  startedAt: new Date().toISOString(),
  durationSec: 0,
  priorityA: 0,
  priorityB: 0,
  examplesInserted: 0,
  skippedDuplicate: 0,
  skippedInvalid: 0,
  backlogA: -1,
  backlogB: -1,
  sample: [],
};

const wallStart = Date.now();

try {
  for (const entry of entries) {
    if (entry.priority === 'A') stats.priorityA++;
    else stats.priorityB++;

    const valid = entry.examples.filter(isValidExample);
    stats.skippedInvalid += entry.examples.length - valid.length;
    if (valid.length === 0) continue;

    const rows = valid.map((ex) => ({
      dictionary_entry_id: entry.dictionary_entry_id,
      sentence_ja: ex.sentence_ja,
      sentence_reading: ex.sentence_reading,
      sentence_meaning: ex.sentence_meaning,
      source: 'claude-routine',
    }));

    const inserted = await sql`
      INSERT INTO word_examples ${sql(rows, 'dictionary_entry_id', 'sentence_ja', 'sentence_reading', 'sentence_meaning', 'source')}
      ON CONFLICT (dictionary_entry_id, sentence_ja) DO NOTHING
      RETURNING id
    `;
    stats.examplesInserted += inserted.length;
    stats.skippedDuplicate += rows.length - inserted.length;

    if (stats.sample.length < 5 && inserted.length > 0) {
      stats.sample.push({
        term: entry.term,
        reading: entry.reading,
        sentence_ja: valid[0].sentence_ja,
        sentence_meaning: valid[0].sentence_meaning,
      });
    }
  }

  const [bA] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM dictionary_entries d
    JOIN words w ON w.dictionary_entry_id = d.id
    LEFT JOIN word_examples we ON we.dictionary_entry_id = d.id
    WHERE we.id IS NULL
  `;
  const [bB] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM dictionary_entries d
    LEFT JOIN word_examples we ON we.dictionary_entry_id = d.id
    WHERE we.id IS NULL
      AND d.source = 'jisho'
      AND NOT EXISTS (SELECT 1 FROM words w WHERE w.dictionary_entry_id = d.id)
  `;
  stats.backlogA = bA.n;
  stats.backlogB = bB.n;
} finally {
  stats.durationSec = Math.round((Date.now() - wallStart) / 1000);
  await sql.end();
}

console.log('=== Stats ===');
console.log(JSON.stringify(stats, null, 2));

async function sendMail(): Promise<void> {
  if (!RESEND_KEY) {
    console.log('[mail] RESEND_API_KEY not set — skipping');
    return;
  }
  const total = stats.priorityA + stats.priorityB;
  if (total === 0) {
    console.log('[mail] nothing processed — skipping');
    return;
  }
  const sampleRows = stats.sample
    .map(
      (r) =>
        `<tr><td style="padding:4px 8px">${r.term}</td><td>${r.reading}</td><td>${r.sentence_ja}</td><td>${r.sentence_meaning}</td></tr>`,
    )
    .join('');
  const html = `
<div style="font-family:system-ui,sans-serif;font-size:14px;color:#222">
  <h2>Daily example enrichment ✓</h2>
  <p>Run finished ${stats.startedAt} · duration ${stats.durationSec}s</p>
  <h3>Counts</h3>
  <ul>
    <li>Priority A (user-linked): ${stats.priorityA}</li>
    <li>Priority B (jisho orphan): ${stats.priorityB}</li>
    <li>Examples inserted: ${stats.examplesInserted}</li>
    <li>Skipped — duplicate: ${stats.skippedDuplicate}</li>
    <li>Skipped — invalid shape: ${stats.skippedInvalid}</li>
  </ul>
  <h3>Backlog after run</h3>
  <ul>
    <li>Priority A: ${stats.backlogA}</li>
    <li>Priority B (jisho): ${stats.backlogB}</li>
  </ul>
  ${stats.sample.length > 0 ? `
  <h3>Sample inserts</h3>
  <table style="border-collapse:collapse;font-size:13px">
    <tr style="background:#f4f4f4"><th style="padding:4px 8px;text-align:left">Term</th><th>Reading</th><th>JA</th><th>KO</th></tr>
    ${sampleRows}
  </table>` : ''}
</div>`.trim();

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: [MAIL_TO],
      subject: `[VocaBook] Daily examples ✓ +${stats.examplesInserted / 2} entries (${stats.priorityA}A/${stats.priorityB}B)`,
      html,
    }),
  });
  if (!res.ok) {
    console.error('[mail] Resend failed:', res.status, await res.text());
  } else {
    console.log('[mail] sent to', MAIL_TO);
  }
}

await sendMail();
