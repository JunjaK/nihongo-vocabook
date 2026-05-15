/**
 * Seed haring157@gmail.com's "생선" and "식재료" wordbooks with curated entries.
 *
 * For each entry (idempotent):
 *   1. Upsert dictionary_entries  (term, reading)              [shared resource]
 *   2. Upsert words               (user_id, dictionary_entry_id) [user resource]
 *   3. Upsert user_word_state     (user_id, word_id)            [SRS scaffold]
 *   4. Upsert wordbook_items      (wordbook_id, word_id)        [link into wordbook]
 *
 * Modes:
 *   Default = dry-run (counts only, no writes)
 *   --apply  = actually write to production
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { FISH } from './seed-data/fish';
import { INGREDIENTS } from './seed-data/ingredients';
import type { SeedEntry } from './seed-data/types';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL = join(SCRIPT_DIR, '..', '.env.local');

const USER_ID = 'f0d89dc0-7b7c-4b72-89a5-4d7d7699b9a7';
const WORDBOOKS = {
  fish: '5d4c790d-7a21-4e96-999f-f7a9e4215988',
  ingredients: '2ba37cba-9e31-42bd-8eb6-fa611f7d21f9',
};

const APPLY = process.argv.includes('--apply');

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

function envOrThrow(name: string): string {
  const fromFile = readFromEnvLocal(name);
  if (fromFile) return fromFile;
  if (process.env[name]) return process.env[name]!;
  throw new Error(`${name} is not set`);
}

const DB_URL = envOrThrow('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION');
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

type WordbookKey = 'fish' | 'ingredients';
interface JobEntry extends SeedEntry {
  wb: WordbookKey;
}

const jobs: JobEntry[] = [
  ...FISH.map((e) => ({ ...e, wb: 'fish' as const })),
  ...INGREDIENTS.map((e) => ({ ...e, wb: 'ingredients' as const })),
];

console.log(`Mode: ${APPLY ? 'APPLY (production write)' : 'DRY-RUN (no writes)'}`);
console.log(`Total seed entries: ${jobs.length}`);

try {
  // ============================================================
  // STEP 1 — Upsert dictionary_entries
  // ============================================================
  console.log('\n[1/4] dictionary_entries...');

  // Look up which are already present (tuple match via VALUES join)
  const existingDictRows = await sql<{ id: string; term: string; reading: string }[]>`
    SELECT d.id, d.term, d.reading
    FROM dictionary_entries d
    JOIN (VALUES ${sql(jobs.map((e) => [e.term, e.reading]))}) v(term, reading)
      ON d.term = v.term AND d.reading = v.reading
  `;
  const dictKey = (t: string, r: string) => `${t}|${r}`;
  const dictMap = new Map<string, string>();
  for (const row of existingDictRows) dictMap.set(dictKey(row.term, row.reading), row.id);

  const toInsertDict = jobs.filter((e) => !dictMap.has(dictKey(e.term, e.reading)));
  console.log(`  existing: ${existingDictRows.length}, new: ${toInsertDict.length}`);

  if (APPLY && toInsertDict.length > 0) {
    const inserted = await sql<{ id: string; term: string; reading: string }[]>`
      INSERT INTO dictionary_entries ${sql(
        toInsertDict.map((e) => ({
          term: e.term,
          reading: e.reading,
          meanings: [e.meaning],
          parts_of_speech: ['Noun'],
          jlpt_level: e.jlpt_level,
          source: 'haring-seed',
        })),
        'term',
        'reading',
        'meanings',
        'parts_of_speech',
        'jlpt_level',
        'source',
      )}
      ON CONFLICT (term, reading) DO NOTHING
      RETURNING id, term, reading
    `;
    for (const row of inserted) dictMap.set(dictKey(row.term, row.reading), row.id);
    // Catch any that somehow conflicted (race / preexisting). Re-select.
    if (inserted.length < toInsertDict.length) {
      const missing = toInsertDict.filter((e) => !dictMap.has(dictKey(e.term, e.reading)));
      const more = await sql<{ id: string; term: string; reading: string }[]>`
        SELECT d.id, d.term, d.reading
        FROM dictionary_entries d
        JOIN (VALUES ${sql(missing.map((e) => [e.term, e.reading]))}) v(term, reading)
          ON d.term = v.term AND d.reading = v.reading
      `;
      for (const row of more) dictMap.set(dictKey(row.term, row.reading), row.id);
    }
    console.log(`  inserted: ${inserted.length} (total mapped: ${dictMap.size})`);
  }

  // ============================================================
  // STEP 2 — Upsert words for this user
  // ============================================================
  console.log('\n[2/4] words...');

  // If dry-run, we may have <458 dict ids mapped (un-inserted) → use placeholders for counting
  const jobsWithDictId = jobs.map((e) => ({
    ...e,
    dict_id: dictMap.get(dictKey(e.term, e.reading)) ?? null,
  }));

  const knownDictIds = jobsWithDictId
    .map((j) => j.dict_id)
    .filter((v): v is string => v !== null);

  const existingWordRows = knownDictIds.length > 0
    ? await sql<{ id: string; dictionary_entry_id: string }[]>`
      SELECT id, dictionary_entry_id FROM words
      WHERE user_id = ${USER_ID}
        AND dictionary_entry_id IN ${sql(knownDictIds)}
    `
    : [];
  const wordMap = new Map<string, string>(); // dict_id -> word_id
  for (const row of existingWordRows) wordMap.set(row.dictionary_entry_id, row.id);

  const toInsertWords = jobsWithDictId.filter(
    (j) => j.dict_id !== null && !wordMap.has(j.dict_id),
  );
  const skippedNoDict = jobsWithDictId.filter((j) => j.dict_id === null).length;
  console.log(`  existing words: ${existingWordRows.length}, new: ${toInsertWords.length}, skipped (no dict id — dry-run): ${skippedNoDict}`);

  if (APPLY && toInsertWords.length > 0) {
    const inserted = await sql<{ id: string; dictionary_entry_id: string }[]>`
      INSERT INTO words ${sql(
        toInsertWords.map((e) => ({
          user_id: USER_ID,
          term: e.term,
          reading: e.reading,
          meaning: e.meaning,
          part_of_speech: 'Noun',
          tags: e.tags,
          jlpt_level: e.jlpt_level,
          dictionary_entry_id: e.dict_id!,
        })),
        'user_id',
        'term',
        'reading',
        'meaning',
        'part_of_speech',
        'tags',
        'jlpt_level',
        'dictionary_entry_id',
      )}
      ON CONFLICT (user_id, dictionary_entry_id) DO NOTHING
      RETURNING id, dictionary_entry_id
    `;
    for (const row of inserted) wordMap.set(row.dictionary_entry_id, row.id);
    console.log(`  inserted: ${inserted.length} (total mapped: ${wordMap.size})`);
  }

  // ============================================================
  // STEP 3 — Upsert user_word_state
  // ============================================================
  console.log('\n[3/4] user_word_state...');
  const wordIds = Array.from(wordMap.values());
  const existingUwsRows = wordIds.length > 0
    ? await sql<{ word_id: string }[]>`
      SELECT word_id FROM user_word_state
      WHERE user_id = ${USER_ID} AND word_id IN ${sql(wordIds)}
    `
    : [];
  const uwsSet = new Set(existingUwsRows.map((r) => r.word_id));
  const toInsertUws = wordIds.filter((wid) => !uwsSet.has(wid));
  console.log(`  existing: ${existingUwsRows.length}, new: ${toInsertUws.length}`);
  if (APPLY && toInsertUws.length > 0) {
    await sql`
      INSERT INTO user_word_state ${sql(
        toInsertUws.map((wid) => ({
          user_id: USER_ID,
          word_id: wid,
          mastered: false,
          priority: 2,
        })),
        'user_id',
        'word_id',
        'mastered',
        'priority',
      )}
      ON CONFLICT (user_id, word_id) DO NOTHING
    `;
    console.log(`  inserted: ${toInsertUws.length}`);
  }

  // ============================================================
  // STEP 4 — Upsert wordbook_items
  // ============================================================
  console.log('\n[4/4] wordbook_items...');
  const wbInserts: { wordbook_id: string; word_id: string }[] = [];
  const wbStats = { fish: { existing: 0, add: 0 }, ingredients: { existing: 0, add: 0 } };

  const existingWbItems = wordIds.length > 0
    ? await sql<{ wordbook_id: string; word_id: string }[]>`
      SELECT wordbook_id, word_id FROM wordbook_items
      WHERE wordbook_id IN ${sql([WORDBOOKS.fish, WORDBOOKS.ingredients])}
        AND word_id IN ${sql(wordIds)}
    `
    : [];
  const wbItemKey = (wb: string, w: string) => `${wb}|${w}`;
  const existingWbSet = new Set(existingWbItems.map((r) => wbItemKey(r.wordbook_id, r.word_id)));

  for (const job of jobsWithDictId) {
    if (job.dict_id === null) continue; // dry-run path; cannot determine
    const wid = wordMap.get(job.dict_id);
    if (!wid) continue;
    const wbId = WORDBOOKS[job.wb];
    if (existingWbSet.has(wbItemKey(wbId, wid))) {
      wbStats[job.wb].existing++;
    } else {
      wbInserts.push({ wordbook_id: wbId, word_id: wid });
      wbStats[job.wb].add++;
    }
  }

  console.log(`  fish        — existing: ${wbStats.fish.existing}, new: ${wbStats.fish.add}`);
  console.log(`  ingredients — existing: ${wbStats.ingredients.existing}, new: ${wbStats.ingredients.add}`);

  if (APPLY && wbInserts.length > 0) {
    await sql`
      INSERT INTO wordbook_items ${sql(wbInserts, 'wordbook_id', 'word_id')}
      ON CONFLICT (wordbook_id, word_id) DO NOTHING
    `;
    console.log(`  inserted: ${wbInserts.length}`);
  }

  console.log('\nDONE.');
} finally {
  await sql.end();
}
