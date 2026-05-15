/**
 * Build chunked input files for sub-agents that need to author
 * English meanings (haring-seed only) + 2 example sentences.
 *
 * Output:
 *   /tmp/haring-enrich/chunk-1.json ... chunk-6.json
 *   /tmp/haring-enrich/manifest.json (full list for reference)
 */
import postgres from 'postgres';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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
const OUT_DIR = '/tmp/haring-enrich';
const N_CHUNKS = 6;

mkdirSync(OUT_DIR, { recursive: true });

interface Row {
  id: string;
  term: string;
  reading: string;
  source: string;
  meanings: string[];
  meanings_ko: string[] | null;
  has_examples: boolean;
}

try {
  const rows = await sql<Row[]>`
    SELECT
      d.id, d.term, d.reading, d.source, d.meanings, d.meanings_ko,
      EXISTS (SELECT 1 FROM word_examples we WHERE we.dictionary_entry_id = d.id) AS has_examples
    FROM dictionary_entries d
    JOIN words w ON w.dictionary_entry_id = d.id
    JOIN wordbook_items wi ON wi.word_id = w.id
    WHERE w.user_id = ${USER_ID} AND wi.wordbook_id IN ${sql(WBS)}
    ORDER BY d.source, d.term
  `;

  // Need authoring if: no examples (always), OR is haring-seed (needs English meanings)
  const targets = rows.filter((r) => !r.has_examples);
  console.log(`Total entries: ${rows.length}`);
  console.log(`Need examples: ${targets.length}`);
  console.log(`Of which haring-seed (also needs English meanings): ${targets.filter((r) => r.source === 'haring-seed').length}`);

  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(targets, null, 2));

  // Split into N chunks
  const chunkSize = Math.ceil(targets.length / N_CHUNKS);
  for (let i = 0; i < N_CHUNKS; i++) {
    const chunk = targets.slice(i * chunkSize, (i + 1) * chunkSize);
    if (chunk.length === 0) break;
    const path = join(OUT_DIR, `chunk-${i + 1}.json`);
    writeFileSync(path, JSON.stringify(chunk, null, 2));
    console.log(`  ${path}: ${chunk.length} entries`);
  }
} finally {
  await sql.end();
}
