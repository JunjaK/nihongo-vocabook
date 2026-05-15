/**
 * Fill meanings_ko for haring-seed entries by copying meanings (already Korean).
 * No external API calls.
 *
 * --apply to write.
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

const APPLY = process.argv.includes('--apply');

try {
  const targets = await sql<{ id: string; term: string; reading: string; meanings: string[] }[]>`
    SELECT id, term, reading, meanings
    FROM dictionary_entries
    WHERE source = 'haring-seed'
      AND (meanings_ko IS NULL OR cardinality(meanings_ko) = 0)
  `;
  console.log(`haring-seed entries needing meanings_ko: ${targets.length}`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  if (targets.length === 0) {
    console.log('Nothing to do.');
  } else if (APPLY) {
    let updated = 0;
    for (const t of targets) {
      await sql`UPDATE dictionary_entries SET meanings_ko = ${t.meanings} WHERE id = ${t.id}`;
      updated++;
      if (updated % 50 === 0) console.log(`  ${updated}/${targets.length}`);
    }
    console.log(`Updated: ${updated}`);
  } else {
    console.log('\nSample (first 5):');
    for (const t of targets.slice(0, 5)) {
      console.log(`  ${t.term}/${t.reading}: meanings_ko ← ${JSON.stringify(t.meanings)}`);
    }
  }
} finally {
  await sql.end();
}
