/**
 * Full coverage report for haring 식재료+생선:
 *   - English meanings (meanings array — Korean strings count as "needs fix" for haring-seed)
 *   - meanings_ko
 *   - word_examples
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
  const rows = await sql<{ source: string; total: number; with_examples: number; no_examples: number }[]>`
    SELECT
      d.source,
      COUNT(DISTINCT d.id)::int AS total,
      COUNT(DISTINCT CASE WHEN we.id IS NOT NULL THEN d.id END)::int AS with_examples,
      COUNT(DISTINCT CASE WHEN we.id IS NULL THEN d.id END)::int AS no_examples
    FROM dictionary_entries d
    JOIN words w ON w.dictionary_entry_id = d.id
    JOIN wordbook_items wi ON wi.word_id = w.id
    LEFT JOIN word_examples we ON we.dictionary_entry_id = d.id
    WHERE w.user_id = ${USER_ID} AND wi.wordbook_id IN ${sql(WBS)}
    GROUP BY d.source
    ORDER BY d.source
  `;
  console.log('=== example coverage by source ===');
  console.table(rows);
} finally {
  await sql.end();
}
