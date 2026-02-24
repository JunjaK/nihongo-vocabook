import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');

function getEnvVar(name: string): string {
  const line = envContent.split('\n').find((l) => l.startsWith(`${name}=`));
  if (!line) { console.error(`${name} not found`); process.exit(1); }
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

async function run() {
  // Step 1: Reset ALL meanings_ko
  const resetResult = await sql`UPDATE dictionary_entries SET meanings_ko = '{}' WHERE meanings_ko != '{}'`;
  console.log(`Step 1: Reset ${resetResult.count} entries`);

  // Step 2: Re-apply system wordbook Korean meanings
  const updateResult = await sql`
    UPDATE dictionary_entries de
    SET meanings_ko = ARRAY[w.meaning]
    FROM words w
    JOIN wordbooks wb ON w.wordbook_id = wb.id
    WHERE wb.is_system = true
      AND de.term = w.term
      AND de.reading = w.reading
      AND w.meaning IS NOT NULL
      AND w.meaning != ''
  `;
  console.log(`Step 2: Re-applied system wordbook Korean meanings to ${updateResult.count} entries`);

  // Step 3: Check remaining
  const remaining = await sql`
    SELECT count(*) as cnt FROM dictionary_entries WHERE meanings_ko = '{}' OR meanings_ko IS NULL
  `;
  console.log(`Step 3: ${remaining[0].cnt} entries still need Korean translation`);

  await sql.end();
}

run();
