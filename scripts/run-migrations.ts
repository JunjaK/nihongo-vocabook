import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local manually to handle special chars (#, etc.) in values
const envPath = join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const dbLine = envContent.split('\n').find(l => l.startsWith('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION='));
if (!dbLine) {
  console.error('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION not found in .env.local');
  process.exit(1);
}

const dbUrl = dbLine.slice('NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION='.length).trim();

// Parse manually: postgresql://user:pass@host:port/db
// Password can contain anything, so find boundaries carefully
const schemeEnd = dbUrl.indexOf('://') + 3;
const rest = dbUrl.slice(schemeEnd); // user:pass@host:port/db

// Last @ separates credentials from host (password may contain @)
const lastAt = rest.lastIndexOf('@');
const credentials = rest.slice(0, lastAt);
const hostPart = rest.slice(lastAt + 1); // host:port/db

const colonIdx = credentials.indexOf(':');
const user = credentials.slice(0, colonIdx);
const password = credentials.slice(colonIdx + 1);

const [hostPort, database] = hostPart.split('/');
const [host, portStr] = hostPort.split(':');
const port = Number(portStr) || 5432;

console.log(`Connecting to ${host}:${port}/${database} as ${user}...`);

const sql = postgres({
  host,
  port,
  database,
  username: user,
  password,
  ssl: 'require',
});

const migrations = [
  '001_initial_schema.sql',
  '002_wordbooks_and_mastered.sql',
  '003_shared_wordbooks.sql',
  '004_user_settings.sql',
  '005_user_profiles.sql',
  '006_dedup_priority_tags.sql',
  '007_dictionary_entries.sql',
  '008_shared_wordbook_items_rls.sql',
  '009_quiz_upgrade.sql',
  '010_user_word_state.sql',
  '011_non_mastered_view.sql',
];

async function run() {
  for (const file of migrations) {
    const path = join(__dirname, '..', 'supabase', 'migrations', file);
    const content = readFileSync(path, 'utf-8');
    console.log(`Running ${file}...`);
    try {
      await sql.unsafe(content);
      console.log(`  OK`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists') || msg.includes('duplicate')) {
        console.log(`  Skipped (already applied)`);
      } else {
        console.error(`  FAILED: ${msg}`);
        process.exit(1);
      }
    }
  }

  await sql.end();
  console.log('\nAll migrations complete.');
}

run();
