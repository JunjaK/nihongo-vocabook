/**
 * Cleanup non-standard / duplicate / wrong-kanji haring-seed entries.
 *
 * Two phases:
 *   REPLACE: change (term, reading) for entries where the standard form is katakana
 *   DELETE:  remove duplicates of existing entries OR non-standard / non-vocab terms
 *
 * Safe to run twice (idempotent — skips rows that no longer match).
 * Use --apply to write.
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

// Old (term, reading) → new (term, reading)
const REPLACES: { from: [string, string]; to: [string, string] }[] = [
  { from: ['鯬', 'えら'], to: ['エラ', 'エラ'] },
  { from: ['鯥', 'むつ'], to: ['ムツ', 'むつ'] },
  { from: ['鯥五郎', 'むつごろう'], to: ['ムツゴロウ', 'むつごろう'] },
  { from: ['鱰', 'しいら'], to: ['シイラ', 'しいら'] },
  { from: ['鱲', 'からすみ'], to: ['からすみ', 'からすみ'] },
];

// (term, reading) to drop entirely (dict + words + wordbook links).
// Only applies when source='haring-seed' (shared dict entries are preserved).
const DELETES: [string, string][] = [
  ['鱝', 'えい'],
  ['鱲子', 'からすみ'],
  ['鰒', 'あわび'],
  ['鯵子', 'あじご'],
  ['鯏', 'あさり'],
  ['鰮', 'いわし'],
  ['鮟', 'あん'],
  ['鯒科', 'こちか'],
  ['鱓子', 'うつぼご'],
  ['鰕虎魚', 'はぜ'],
  ['鰰子', 'はたはたこ'],
  ['海参', 'いりこ'],
  ['鰐', 'わに'],
];

// Just unlink from haring's wordbook (dict is shared, preserve it).
const UNLINKS: [string, string][] = [
  ['玉蜀黍', 'とうもろこし'], // jmdict — keep dict, drop from haring wordbook
];

const HARING_USER_ID = 'f0d89dc0-7b7c-4b72-89a5-4d7d7699b9a7';

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

try {
  // ============================================================
  // REPLACE phase
  // ============================================================
  console.log(`\n[REPLACE] ${REPLACES.length} entries`);
  for (const rep of REPLACES) {
    const [oldT, oldR] = rep.from;
    const [newT, newR] = rep.to;

    // Find the haring-seed row
    const found = await sql<{ id: string }[]>`
      SELECT id FROM dictionary_entries
      WHERE term = ${oldT} AND reading = ${oldR} AND source = 'haring-seed'
    `;
    if (found.length === 0) {
      console.log(`  skip: ${oldT}/${oldR} (not found)`);
      continue;
    }
    const dictId = found[0].id;

    // Conflict check: new (term, reading) already exists?
    const conflict = await sql<{ id: string; source: string }[]>`
      SELECT id, source FROM dictionary_entries
      WHERE term = ${newT} AND reading = ${newR}
    `;
    if (conflict.length > 0) {
      console.log(`  conflict: ${oldT}/${oldR} → ${newT}/${newR} exists (source=${conflict[0].source}); skipping`);
      continue;
    }

    console.log(`  ${oldT}/${oldR}  →  ${newT}/${newR}`);
    if (APPLY) {
      await sql.begin(async (tx) => {
        await tx`UPDATE dictionary_entries SET term = ${newT}, reading = ${newR} WHERE id = ${dictId}`;
        await tx`UPDATE words SET term = ${newT}, reading = ${newR} WHERE dictionary_entry_id = ${dictId}`;
      });
    }
  }

  // ============================================================
  // DELETE phase
  // ============================================================
  console.log(`\n[DELETE] ${DELETES.length} entries`);
  for (const [t, r] of DELETES) {
    const found = await sql<{ id: string }[]>`
      SELECT id FROM dictionary_entries
      WHERE term = ${t} AND reading = ${r} AND source = 'haring-seed'
    `;
    if (found.length === 0) {
      console.log(`  skip: ${t}/${r} (not found)`);
      continue;
    }
    const dictId = found[0].id;

    const wordRows = await sql<{ id: string }[]>`
      SELECT id FROM words WHERE dictionary_entry_id = ${dictId}
    `;
    console.log(`  ${t}/${r} (dict_id=${dictId.slice(0, 8)}…, words=${wordRows.length})`);

    if (APPLY) {
      await sql.begin(async (tx) => {
        if (wordRows.length > 0) {
          const wordIds = wordRows.map((w) => w.id);
          await tx`DELETE FROM wordbook_items WHERE word_id IN ${tx(wordIds)}`;
          await tx`DELETE FROM user_word_state WHERE word_id IN ${tx(wordIds)}`;
          await tx`DELETE FROM word_examples WHERE dictionary_entry_id = ${dictId}`;
          await tx`DELETE FROM words WHERE id IN ${tx(wordIds)}`;
        }
        await tx`DELETE FROM dictionary_entries WHERE id = ${dictId}`;
      });
    }
  }

  // ============================================================
  // UNLINK phase (shared dict — only drop user's word + wordbook link)
  // ============================================================
  console.log(`\n[UNLINK] ${UNLINKS.length} entries (preserve dict, drop from haring's wordbook only)`);
  for (const [t, r] of UNLINKS) {
    const found = await sql<{ id: string; source: string }[]>`
      SELECT id, source FROM dictionary_entries
      WHERE term = ${t} AND reading = ${r}
    `;
    if (found.length === 0) {
      console.log(`  skip: ${t}/${r} (dict not found)`);
      continue;
    }
    const dictId = found[0].id;

    const wordRows = await sql<{ id: string }[]>`
      SELECT id FROM words
      WHERE dictionary_entry_id = ${dictId} AND user_id = ${HARING_USER_ID}
    `;
    if (wordRows.length === 0) {
      console.log(`  skip: ${t}/${r} (user has no word linked)`);
      continue;
    }
    console.log(`  ${t}/${r} (dict source=${found[0].source}, kept; haring word_id=${wordRows[0].id.slice(0, 8)}… dropped)`);
    if (APPLY) {
      await sql.begin(async (tx) => {
        const wordIds = wordRows.map((w) => w.id);
        await tx`DELETE FROM wordbook_items WHERE word_id IN ${tx(wordIds)}`;
        await tx`DELETE FROM user_word_state WHERE word_id IN ${tx(wordIds)}`;
        await tx`DELETE FROM words WHERE id IN ${tx(wordIds)}`;
      });
    }
  }

  console.log('\nDONE.');
} finally {
  await sql.end();
}
