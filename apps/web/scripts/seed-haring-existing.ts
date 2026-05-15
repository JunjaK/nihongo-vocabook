/**
 * Show existing words in the two wordbooks (term, reading, meaning).
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL = join(SCRIPT_DIR, '..', '.env.local');

function readFromEnvLocal(name: string): string | undefined {
  try {
    const content = readFileSync(ENV_LOCAL, 'utf-8');
    const line = content.split('\n').find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim();
  } catch {
    /* ignore */
  }
  return undefined;
}

const DB_URL = readFromEnvLocal('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION') ?? '';
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

const WBS = {
  fish: '5d4c790d-7a21-4e96-999f-f7a9e4215988',
  ingredients: '2ba37cba-9e31-42bd-8eb6-fa611f7d21f9',
};

try {
  for (const [key, id] of Object.entries(WBS)) {
    const rows = await sql<{ term: string; reading: string; meaning: string }[]>`
      SELECT w.term, w.reading, w.meaning FROM wordbook_items wi
      JOIN words w ON w.id = wi.word_id
      WHERE wi.wordbook_id = ${id}
    `;
    console.log(`=== ${key} (${id}) ===`);
    for (const r of rows) console.log(`  ${r.term} (${r.reading}) — ${r.meaning}`);
  }
} finally {
  await sql.end();
}
