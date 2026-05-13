/**
 * Fetch dictionary entries needing example sentences.
 *
 * Priority A: user-linked & no examples (DESC by created_at)
 * Priority B: jisho orphan & no examples (ASC by created_at) — used only when A is empty/under cap
 *
 * Output: JSON array on stdout, shape:
 *   [{ id, term, reading, meanings, meanings_ko, source, priority }]
 *
 * Env:
 *   NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION
 *   DAILY_CAP (default 100)
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

function envOrDefault(name: string, fallback: string): string {
  const fromFile = readFromEnvLocal(name);
  if (fromFile) return fromFile;
  if (process.env[name]) return process.env[name]!;
  return fallback;
}

const DB_URL = envOrThrow('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION');
const DAILY_CAP = Number(envOrDefault('DAILY_CAP', '100'));

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

interface Row {
  id: string;
  term: string;
  reading: string;
  meanings: string[];
  meanings_ko: string[] | null;
  source: string;
}

try {
  const aRows = await sql<Row[]>`
    SELECT d.id, d.term, d.reading, d.meanings, d.meanings_ko, d.source
    FROM dictionary_entries d
    JOIN words w ON w.dictionary_entry_id = d.id
    LEFT JOIN word_examples we ON we.dictionary_entry_id = d.id
    WHERE we.id IS NULL
    GROUP BY d.id
    ORDER BY d.created_at DESC
    LIMIT ${DAILY_CAP}
  `;
  const remaining = DAILY_CAP - aRows.length;
  const bRows = remaining > 0
    ? await sql<Row[]>`
        SELECT d.id, d.term, d.reading, d.meanings, d.meanings_ko, d.source
        FROM dictionary_entries d
        LEFT JOIN word_examples we ON we.dictionary_entry_id = d.id
        WHERE we.id IS NULL
          AND d.source = 'jisho'
          AND NOT EXISTS (SELECT 1 FROM words w WHERE w.dictionary_entry_id = d.id)
        ORDER BY d.created_at ASC
        LIMIT ${remaining}
      `
    : [];

  const output = [
    ...aRows.map((row) => ({ ...row, priority: 'A' as const })),
    ...bRows.map((row) => ({ ...row, priority: 'B' as const })),
  ];
  process.stdout.write(JSON.stringify(output, null, 2));
} finally {
  await sql.end();
}
