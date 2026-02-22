import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Load .env.local manually (same pattern as run-migrations.ts)
import { dirname } from 'path';
import { fileURLToPath } from 'url';
const __scriptDir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__scriptDir, '..', '.env.local');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
} catch {
  // .env.local not found, rely on existing env vars
}

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    'Missing Supabase credentials. Set SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BATCH_SIZE = 500;

interface DictRow {
  term: string;
  reading: string;
  meanings: string[];
  parts_of_speech: string[];
  jlpt_level: number | null;
  source: string;
}

// ---------- CSV parser (handles quoted fields) ----------

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ---------- Batch upsert helper ----------

async function batchUpsert(rows: DictRow[], label: string): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('dictionary_entries')
      .upsert(batch, { onConflict: 'term,reading', ignoreDuplicates: true });

    if (error) {
      console.error(`  Batch error at ${i}: ${error.message}`);
    } else {
      inserted += batch.length;
    }

    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= rows.length) {
      console.log(`  ${label}: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length} processed`);
    }
  }
  return inserted;
}

// ---------- Phase 1: JLPT words ----------

async function seedJlpt(): Promise<number> {
  console.log('\n--- Phase 1: JLPT words ---\n');
  const levels = [5, 4, 3, 2, 1];
  let totalRows = 0;

  for (const level of levels) {
    const url = `https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n${level}.csv`;
    console.log(`Fetching N${level} from ${url}...`);

    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  Failed to fetch N${level}: ${res.status}`);
      continue;
    }

    const csv = await res.text();
    const lines = csv.split('\n').filter((l) => l.trim());

    // Skip header row: expression,reading,meaning,tags,guid
    const rows: DictRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      if (fields.length < 3) continue;

      const [expression, reading, meaning] = fields;
      if (!expression) continue;

      // Split meaning on commas that are outside quotes (already parsed)
      const meanings = meaning
        .split(/,\s*/)
        .map((m) => m.trim())
        .filter(Boolean)
        .slice(0, 5);

      rows.push({
        term: expression,
        reading: reading || '',
        meanings,
        parts_of_speech: [],
        jlpt_level: level,
        source: 'jlpt-seed',
      });
    }

    const count = await batchUpsert(rows, `N${level}`);
    console.log(`  N${level}: ${rows.length} words parsed, ${count} sent to DB`);
    totalRows += rows.length;
  }

  return totalRows;
}

// ---------- Phase 2: JMDict common words ----------

interface JmDictWord {
  kanji: { text: string; common: boolean }[];
  kana: { text: string; common: boolean }[];
  sense: {
    partOfSpeech: string[];
    gloss: { lang: string; text: string }[];
  }[];
}

interface JmDictData {
  words: JmDictWord[];
}

async function resolveJmdictUrl(): Promise<string> {
  // Asset filenames now include the version, so use GitHub API to find the correct URL
  const apiUrl =
    'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
  const res = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'nihongo-vocabook-seed' },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  const release = await res.json();
  const asset = (release.assets as { name: string; browser_download_url: string }[]).find(
    (a) => a.name.startsWith('jmdict-eng-common') && a.name.endsWith('.json.tgz'),
  );
  if (!asset) throw new Error('jmdict-eng-common asset not found in latest release');
  return asset.browser_download_url;
}

async function seedJmdict(): Promise<number> {
  console.log('\n--- Phase 2: JMDict common words ---\n');

  const url = await resolveJmdictUrl();
  console.log(`Downloading JMDict from ${url}...`);

  const tmpDir = join(tmpdir(), `jmdict-seed-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }

    const tgzPath = join(tmpDir, 'jmdict.tgz');
    writeFileSync(tgzPath, Buffer.from(await res.arrayBuffer()));
    console.log('  Downloaded, extracting...');

    execSync(`tar xzf "${tgzPath}" -C "${tmpDir}"`, { stdio: 'pipe' });

    // Find the extracted JSON file (name includes version)
    const files = execSync(`ls "${tmpDir}"`, { encoding: 'utf-8' }).split('\n');
    const jsonFile = files.find(
      (f) => f.startsWith('jmdict-eng-common') && f.endsWith('.json'),
    );
    if (!jsonFile) throw new Error('Extracted JSON file not found');

    const jsonPath = join(tmpDir, jsonFile);
    const data: JmDictData = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    console.log(`  Parsed ${data.words.length} JMDict entries`);

    const rows: DictRow[] = [];
    for (const word of data.words) {
      const term =
        word.kanji.length > 0 ? word.kanji[0].text : word.kana[0]?.text;
      const reading = word.kana[0]?.text ?? '';
      if (!term) continue;

      const firstSense = word.sense[0];
      if (!firstSense) continue;

      const meanings = firstSense.gloss
        .filter((g) => g.lang === 'eng')
        .map((g) => g.text)
        .slice(0, 5);

      if (meanings.length === 0) continue;

      rows.push({
        term,
        reading,
        meanings,
        parts_of_speech: firstSense.partOfSpeech ?? [],
        jlpt_level: null,
        source: 'jmdict',
      });
    }

    console.log(`  ${rows.length} entries to upsert (ON CONFLICT DO NOTHING)...`);
    const count = await batchUpsert(rows, 'JMDict');
    console.log(`  JMDict: ${count} sent to DB (existing JLPT entries preserved)`);
    return rows.length;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------- Main ----------

async function main() {
  console.log('=== Dictionary Seed ===');

  const jlptCount = await seedJlpt();
  const jmdictCount = await seedJmdict();

  // Final count
  const { count, error } = await supabase
    .from('dictionary_entries')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error(`\nCount query failed: ${error.message}`);
  } else {
    console.log(`\n=== Done ===`);
    console.log(`JLPT rows parsed: ${jlptCount}`);
    console.log(`JMDict rows parsed: ${jmdictCount}`);
    console.log(`Total DB rows: ${count}`);
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
