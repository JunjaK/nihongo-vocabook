import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');

function getEnvVar(name: string): string {
  const line = envContent.split('\n').find((l) => l.startsWith(`${name}=`));
  if (!line) {
    console.error(`${name} not found in .env.local`);
    process.exit(1);
  }
  return line.slice(name.length + 1).trim();
}

const dbUrl = getEnvVar('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION');

const schemeEnd = dbUrl.indexOf('://') + 3;
const rest = dbUrl.slice(schemeEnd);
const lastAt = rest.lastIndexOf('@');
const credentials = rest.slice(0, lastAt);
const hostPart = rest.slice(lastAt + 1);
const colonIdx = credentials.indexOf(':');
const user = credentials.slice(0, colonIdx);
const password = credentials.slice(colonIdx + 1);
const [hostPort, database] = hostPart.split('/');
const [host, portStr] = hostPort.split(':');
const port = Number(portStr) || 5432;

const sql = postgres({ host, port, database, username: user, password, ssl: 'require' });

const JP_TERM_RE = /^[㐀-䶿一-鿿぀-ゟ゠-ヿーー々〆〤]+$/u;
const JP_READING_RE = /^[぀-ゟ゠-ヿーー]*$/u;

type WordRow = {
  id: string;
  term: string;
  reading: string;
  meaning: string;
  user_id: string;
};

function classify(term: string, reading: string): 'normal' | 'garbage' | 'needs_review' {
  const t = term ?? '';
  const r = reading ?? '';
  if (t.trim() === '') return 'garbage';
  if (t.length > 20) return 'garbage';
  if (/^[\p{P}\p{S}]+$/u.test(t)) return 'garbage';
  if (r.length > 30) return 'garbage';
  const termOk = JP_TERM_RE.test(t);
  const readingOk = JP_READING_RE.test(r);
  if (termOk && readingOk) return 'normal';
  const hasJp = /[㐀-鿿぀-ヿ]/u.test(t);
  if (!hasJp) return 'garbage';
  return 'needs_review';
}

async function main() {
  console.log('=== Word / Dict Link Audit ===\n');

  const [counts] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM words) AS words_total,
      (SELECT COUNT(*)::int FROM word_examples) AS examples_total,
      (SELECT COUNT(*)::int FROM dictionary_entries) AS dict_total
  `;
  console.log('Totals:');
  console.log(`  words:              ${counts.words_total}`);
  console.log(`  word_examples:      ${counts.examples_total}`);
  console.log(`  dictionary_entries: ${counts.dict_total}\n`);

  const orphans = (await sql`
    SELECT w.id, w.term, w.reading, w.meaning, w.user_id
    FROM words w
    LEFT JOIN dictionary_entries d ON d.term = w.term AND d.reading = w.reading
    WHERE d.id IS NULL
    ORDER BY w.created_at DESC
  `) as unknown as WordRow[];

  const buckets = { normal: [] as WordRow[], garbage: [] as WordRow[], needs_review: [] as WordRow[] };
  for (const w of orphans) {
    buckets[classify(w.term, w.reading)].push(w);
  }

  console.log(`Words with NO matching dict_entries row: ${orphans.length}`);
  console.log(`  normal (will upsert to dict):   ${buckets.normal.length}`);
  console.log(`  garbage (will DELETE):          ${buckets.garbage.length}`);
  console.log(`  needs review (manual decision): ${buckets.needs_review.length}\n`);

  if (buckets.garbage.length > 0) {
    console.log('--- Garbage samples (first 30) ---');
    for (const w of buckets.garbage.slice(0, 30)) {
      console.log(`  [${w.id}] term=${JSON.stringify(w.term)} reading=${JSON.stringify(w.reading)}`);
    }
    console.log();
  }

  if (buckets.needs_review.length > 0) {
    console.log('--- Needs review samples (first 30) ---');
    for (const w of buckets.needs_review.slice(0, 30)) {
      console.log(`  [${w.id}] term=${JSON.stringify(w.term)} reading=${JSON.stringify(w.reading)} meaning=${JSON.stringify(w.meaning)}`);
    }
    console.log();
  }

  const emptyMeanings = await sql`
    SELECT COUNT(*)::int AS n
    FROM dictionary_entries
    WHERE cardinality(meanings) = 0
  `;
  console.log(`Dict entries with empty meanings: ${emptyMeanings[0].n}`);

  const examplesOrphaned = await sql`
    SELECT COUNT(*)::int AS n
    FROM word_examples we
    LEFT JOIN words w ON w.id = we.word_id
    WHERE w.id IS NULL
  `;
  console.log(`word_examples rows whose word is already gone: ${examplesOrphaned[0].n}`);

  const userTermDupes = await sql`
    SELECT user_id, term, reading, COUNT(*)::int AS n
    FROM words
    GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 20
  `;
  console.log(`\nUser-level duplicate words (same user, same term+reading): ${userTermDupes.length}`);
  for (const row of userTermDupes) {
    console.log(`  user=${row.user_id} term=${row.term} reading=${row.reading} n=${row.n}`);
  }

  const reportPath = join(__dirname, '..', '..', '..', '_docs', 'audit-word-dict-link-report.json');
  const report = {
    generatedAt: new Date().toISOString(),
    totals: counts,
    orphans: {
      total: orphans.length,
      normal: buckets.normal.length,
      garbage: buckets.garbage.length,
      needs_review: buckets.needs_review.length,
    },
    garbageSamples: buckets.garbage.slice(0, 100),
    needsReviewSamples: buckets.needs_review.slice(0, 100),
    emptyMeaningsCount: emptyMeanings[0].n,
    examplesOrphanedCount: examplesOrphaned[0].n,
    userTermDupes,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to ${reportPath}`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
