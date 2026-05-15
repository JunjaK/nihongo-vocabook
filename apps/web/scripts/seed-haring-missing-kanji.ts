/**
 * Identify CJK kanji used in haring-seed terms that are missing from `kanjis` table.
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

// CJK Unified (U+4E00..9FFF) + CJK Ext A (U+3400..4DBF) + iteration mark 々
function isKanji(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  if (cp >= 0x4e00 && cp <= 0x9fff) return true;
  if (cp >= 0x3400 && cp <= 0x4dbf) return true;
  return false;
}

try {
  const rows = await sql<{ term: string }[]>`
    SELECT term FROM dictionary_entries WHERE source = 'haring-seed'
  `;

  // Collect distinct kanji + which terms use them
  const kanjiUsage = new Map<string, string[]>();
  for (const { term } of rows) {
    for (const ch of term) {
      if (!isKanji(ch)) continue;
      if (!kanjiUsage.has(ch)) kanjiUsage.set(ch, []);
      kanjiUsage.get(ch)!.push(term);
    }
  }
  const distinctKanji = Array.from(kanjiUsage.keys());
  console.log(`Distinct kanji in haring-seed terms: ${distinctKanji.length}`);

  const existing = await sql<{ character: string }[]>`
    SELECT character FROM kanjis WHERE character IN ${sql(distinctKanji)}
  `;
  const existingSet = new Set(existing.map((r) => r.character));
  const missing = distinctKanji.filter((k) => !existingSet.has(k));

  console.log(`Existing in kanjis table: ${existing.length}`);
  console.log(`Missing: ${missing.length}\n`);

  if (missing.length > 0) {
    console.log('Missing kanji (with terms that use them):');
    for (const k of missing) {
      const terms = Array.from(new Set(kanjiUsage.get(k)));
      console.log(`  ${k} (U+${k.codePointAt(0)!.toString(16).toUpperCase()}) — ${terms.join(', ')}`);
    }
  }
} finally {
  await sql.end();
}
