import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const envContent = readFileSync(envPath, 'utf-8');

function getEnvVar(name: string): string {
  const line = envContent.split('\n').find((l) => l.startsWith(`${name}=`));
  if (!line) {
    console.error(`${name} not found`);
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
const sql = postgres({
  host,
  port: Number(portStr) || 5432,
  database,
  username: user,
  password,
  ssl: 'require',
});

const rows = await sql`
  SELECT w.id, w.term, w.reading, w.meaning, w.created_at
  FROM words w
  LEFT JOIN dictionary_entries d ON d.term = w.term AND d.reading = w.reading
  WHERE d.id IS NULL
  ORDER BY w.created_at DESC
`;

for (const r of rows) {
  console.log(`term=${JSON.stringify(r.term)}  reading=${JSON.stringify(r.reading)}  meaning=${JSON.stringify(r.meaning)}`);
}

await sql.end();
