/**
 * Sanity check the seed data:
 * - Detect intra-list (term, reading) duplicates
 * - Detect overlap with existing wordbook entries (already in DB)
 */
import { FISH } from './seed-data/fish';
import { INGREDIENTS } from './seed-data/ingredients';
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

function dupKey(t: string, r: string) {
  return `${t}|${r}`;
}

function findDupes(list: { term: string; reading: string }[], label: string) {
  const seen = new Map<string, number>();
  const dupes: string[] = [];
  for (const e of list) {
    const k = dupKey(e.term, e.reading);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, n] of seen) if (n > 1) dupes.push(`  ${label}: ${k} (x${n})`);
  return dupes;
}

const dupes = [...findDupes(FISH, 'fish'), ...findDupes(INGREDIENTS, 'ingredients')];

console.log(`fish total:        ${FISH.length}`);
console.log(`ingredients total: ${INGREDIENTS.length}`);
console.log(`grand total:       ${FISH.length + INGREDIENTS.length}`);
if (dupes.length > 0) {
  console.log('\nDuplicates within seed lists:');
  for (const d of dupes) console.log(d);
} else {
  console.log('\nNo intra-list duplicates.');
}

// Check against existing dict entries in DB
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

try {
  const all = [...FISH, ...INGREDIENTS];
  const tuples = all.map((e) => `(${escape(e.term)},${escape(e.reading)})`);
  function escape(v: string) {
    return `'${v.replace(/'/g, "''")}'`;
  }
  const rows = await sql.unsafe<{ term: string; reading: string }[]>(
    `SELECT term, reading FROM dictionary_entries WHERE (term, reading) IN (${tuples.join(',')})`
  );
  console.log(`\nExisting dict entries (will be reused, not duplicated): ${rows.length}`);
  if (rows.length > 0 && rows.length <= 30) {
    for (const r of rows) console.log(`  ${r.term} (${r.reading})`);
  }
} finally {
  await sql.end();
}
