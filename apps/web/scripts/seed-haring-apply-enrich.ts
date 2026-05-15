/**
 * Apply sub-agent enrichment outputs to production DB.
 *
 *  - Reads out-1.json … out-6.json (sub-agent results)
 *  - Validates schema, counts
 *  - For haring-seed entries with `english_meanings`: UPDATE dictionary_entries.meanings
 *  - INSERT word_examples (dictionary_entry_id, sentence_ja, sentence_meaning, source='haring-seed')
 *      with ON CONFLICT (dictionary_entry_id, sentence_ja) DO NOTHING.
 *
 *  --apply to write.
 */
import postgres from 'postgres';
import { readFileSync, existsSync } from 'fs';
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
const OUT_DIR = '/tmp/haring-enrich';

interface ExampleOut {
  sentence_ja: string;
  sentence_ko: string;
}
interface EntryOut {
  id: string;
  english_meanings: string[] | null;
  examples: ExampleOut[];
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

const allEntries: EntryOut[] = [];
for (let i = 1; i <= 6; i++) {
  const path = join(OUT_DIR, `out-${i}.json`);
  if (!existsSync(path)) {
    console.log(`  MISSING: ${path}`);
    continue;
  }
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as EntryOut[];
  console.log(`  out-${i}.json: ${parsed.length} entries`);
  allEntries.push(...parsed);
}
console.log(`Total entries loaded: ${allEntries.length}`);

// Validate
let validationErrors = 0;
for (const e of allEntries) {
  if (!e.id || typeof e.id !== 'string') {
    console.error(`  bad id: ${JSON.stringify(e)}`);
    validationErrors++;
    continue;
  }
  if (e.english_meanings !== null && !Array.isArray(e.english_meanings)) {
    console.error(`  bad english_meanings: ${e.id}`);
    validationErrors++;
  }
  if (!Array.isArray(e.examples) || e.examples.length !== 2) {
    console.error(`  bad examples count: ${e.id} → ${e.examples?.length}`);
    validationErrors++;
  } else {
    for (const ex of e.examples) {
      if (!ex.sentence_ja || !ex.sentence_ko) {
        console.error(`  bad example: ${e.id} → ${JSON.stringify(ex)}`);
        validationErrors++;
      }
    }
  }
}
if (validationErrors > 0) {
  console.log(`\n${validationErrors} validation errors. Aborting.`);
  await sql.end();
  process.exit(1);
}

const withMeanings = allEntries.filter((e) => e.english_meanings !== null);
console.log(`\nEntries with English meanings to update: ${withMeanings.length}`);
console.log(`Total example sentences to insert: ${allEntries.length * 2}`);

try {
  if (!APPLY) {
    // Show samples
    console.log('\nSample (first 3):');
    for (const e of allEntries.slice(0, 3)) {
      console.log(`  ${e.id.slice(0, 8)}: en=${JSON.stringify(e.english_meanings)}`);
      for (const ex of e.examples) console.log(`    JA: ${ex.sentence_ja}  KO: ${ex.sentence_ko}`);
    }
  } else {
    // STEP 1 — UPDATE meanings (haring-seed only)
    console.log('\n[1/2] UPDATE dictionary_entries.meanings (English)...');
    let mUpdated = 0;
    for (const e of withMeanings) {
      await sql`UPDATE dictionary_entries SET meanings = ${e.english_meanings} WHERE id = ${e.id} AND source = 'haring-seed'`;
      mUpdated++;
      if (mUpdated % 50 === 0) console.log(`  ${mUpdated}/${withMeanings.length}`);
    }
    console.log(`  updated: ${mUpdated}`);

    // STEP 2 — INSERT word_examples (idempotent via unique constraint)
    console.log('\n[2/2] INSERT word_examples...');
    const exampleRows: { dictionary_entry_id: string; sentence_ja: string; sentence_meaning: string; source: string }[] = [];
    for (const e of allEntries) {
      for (const ex of e.examples) {
        exampleRows.push({
          dictionary_entry_id: e.id,
          sentence_ja: ex.sentence_ja,
          sentence_meaning: ex.sentence_ko,
          source: 'haring-seed',
        });
      }
    }
    // Batch insert in chunks of 200
    const CHUNK = 200;
    let inserted = 0;
    for (let i = 0; i < exampleRows.length; i += CHUNK) {
      const slice = exampleRows.slice(i, i + CHUNK);
      const result = await sql`
        INSERT INTO word_examples ${sql(slice, 'dictionary_entry_id', 'sentence_ja', 'sentence_meaning', 'source')}
        ON CONFLICT (dictionary_entry_id, sentence_ja) DO NOTHING
      `;
      inserted += result.count;
      console.log(`  chunk ${Math.floor(i / CHUNK) + 1}: +${result.count} (running total ${inserted}/${exampleRows.length})`);
    }
    console.log(`  inserted: ${inserted} of ${exampleRows.length} attempted`);
  }

  console.log('\nDONE.');
} finally {
  await sql.end();
}
