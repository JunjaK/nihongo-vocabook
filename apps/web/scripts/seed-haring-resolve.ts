/**
 * Resolve haring157@gmail.com user_id, 식재료/생선 wordbook ids,
 * and the set of existing dictionary_entry_ids already in those wordbooks.
 *
 * Output: JSON on stdout
 *   {
 *     user_id,
 *     wordbooks: { ingredients: {id, name, count}, fish: {id, name, count} },
 *     existing_dict_ids: { ingredients: [..], fish: [..] }
 *   }
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL = join(SCRIPT_DIR, '..', '.env.local');

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

try {
  const userRows = await sql<{ id: string }[]>`
    SELECT id FROM auth.users WHERE email = 'haring157@gmail.com' LIMIT 1
  `;
  if (userRows.length === 0) throw new Error('user not found');
  const user_id = userRows[0].id;

  const wbRows = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM wordbooks
    WHERE user_id = ${user_id}
      AND (name ILIKE '%식재료%' OR name ILIKE '%생선%' OR name ILIKE '%魚%' OR name ILIKE '%食材%')
  `;

  const result: {
    user_id: string;
    wordbooks: Record<string, { id: string; name: string; count: number }>;
    existing_dict_ids: Record<string, string[]>;
  } = {
    user_id,
    wordbooks: {},
    existing_dict_ids: {},
  };

  for (const wb of wbRows) {
    const itemRows = await sql<{ dictionary_entry_id: string }[]>`
      SELECT w.dictionary_entry_id FROM wordbook_items wi
      JOIN words w ON w.id = wi.word_id
      WHERE wi.wordbook_id = ${wb.id}
    `;
    const key = wb.name.includes('생선') || wb.name.includes('魚') ? 'fish' : 'ingredients';
    result.wordbooks[key] = { id: wb.id, name: wb.name, count: itemRows.length };
    result.existing_dict_ids[key] = itemRows.map((r) => r.dictionary_entry_id);
  }

  process.stdout.write(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
