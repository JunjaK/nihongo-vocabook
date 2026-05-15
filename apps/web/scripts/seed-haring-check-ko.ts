/**
 * Check meanings_ko coverage for haring-seed entries and reused entries.
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL = join(SCRIPT_DIR, '..', '.env.local');
const DB_URL =
  readFileSync(ENV_LOCAL, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION='))
    ?.slice('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION='.length)
    .trim() ?? '';

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

const USER_ID = 'f0d89dc0-7b7c-4b72-89a5-4d7d7699b9a7';
const WBS = ['5d4c790d-7a21-4e96-999f-f7a9e4215988', '2ba37cba-9e31-42bd-8eb6-fa611f7d21f9'];

try {
  // All dict entries linked to the user's two wordbooks
  const all = await sql<{ source: string; total: number; ko_null: number; ko_filled: number }[]>`
    SELECT
      d.source,
      COUNT(*)::int                                        AS total,
      COUNT(*) FILTER (WHERE d.meanings_ko IS NULL
                         OR cardinality(d.meanings_ko) = 0)::int AS ko_null,
      COUNT(*) FILTER (WHERE d.meanings_ko IS NOT NULL
                         AND cardinality(d.meanings_ko) > 0)::int AS ko_filled
    FROM dictionary_entries d
    JOIN words w ON w.dictionary_entry_id = d.id
    JOIN wordbook_items wi ON wi.word_id = w.id
    WHERE w.user_id = ${USER_ID} AND wi.wordbook_id IN ${sql(WBS)}
    GROUP BY d.source
    ORDER BY d.source
  `;

  console.log('=== meanings_ko coverage by source (in haring 식재료+생선) ===');
  console.table(all);

  // Sample a few haring-seed rows
  const sampleSeed = await sql<{ term: string; reading: string; meanings: string[]; meanings_ko: string[] | null }[]>`
    SELECT term, reading, meanings, meanings_ko
    FROM dictionary_entries WHERE source = 'haring-seed' LIMIT 5
  `;
  console.log('\n=== haring-seed sample (meanings already in Korean) ===');
  for (const r of sampleSeed) console.log(`  ${r.term}/${r.reading}: meanings=${JSON.stringify(r.meanings)} ko=${JSON.stringify(r.meanings_ko)}`);

  // Sample reused (non-seed) rows with NULL meanings_ko
  const sampleReused = await sql<{ term: string; reading: string; source: string; meanings: string[]; meanings_ko: string[] | null }[]>`
    SELECT d.term, d.reading, d.source, d.meanings, d.meanings_ko
    FROM dictionary_entries d
    JOIN words w ON w.dictionary_entry_id = d.id
    JOIN wordbook_items wi ON wi.word_id = w.id
    WHERE w.user_id = ${USER_ID}
      AND wi.wordbook_id IN ${sql(WBS)}
      AND d.source != 'haring-seed'
      AND (d.meanings_ko IS NULL OR cardinality(d.meanings_ko) = 0)
    LIMIT 10
  `;
  console.log('\n=== reused entries with NULL meanings_ko (sample) ===');
  for (const r of sampleReused) console.log(`  ${r.term}/${r.reading} (${r.source}): meanings=${JSON.stringify(r.meanings)} ko=${JSON.stringify(r.meanings_ko)}`);
} finally {
  await sql.end();
}
