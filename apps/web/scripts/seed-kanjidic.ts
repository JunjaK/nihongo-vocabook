/**
 * Seed kanjis + kanji_readings tables from a KANJIDIC2-derived JSON file.
 *
 * Input file: apps/web/scripts/data/kanjidic2.json (or path via $KANJIDIC_PATH env var)
 *
 * Expected JSON shape (compact KANJIDIC2 dump, one object per kanji):
 * {
 *   "characters": [
 *     {
 *       "literal": "生",
 *       "stroke_count": 5,
 *       "jlpt": 5,
 *       "grade": 1,
 *       "frequency": 29,
 *       "on_readings": ["セイ", "ショウ"],
 *       "kun_readings": ["い.きる", "い.かす", "う.まれる"]
 *     },
 *     ...
 *   ]
 * }
 *
 * Download KANJIDIC2 JSON from a public mirror such as
 * https://github.com/scriptin/kanjidic2-json (kanjidic2-en-3.x.json).
 * The script tolerates several common field name variants (kept lenient on purpose
 * so different upstream dumps can be used without pre-processing).
 *
 * Usage:
 *   bun run apps/web/scripts/seed-kanjidic.ts
 *
 * Idempotent: safe to re-run. Uses a direct Postgres connection (bypasses RLS)
 * via NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION loaded from .env.local — same pattern
 * as the other backfill scripts in this directory.
 */

import postgres from 'postgres';
import { readFileSync, existsSync } from 'fs';
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

interface Reading {
  type: string;
  value: string;
}

interface Group {
  readings?: Reading[];
}

interface KanjidicEntry {
  // jmdict-simplified shape
  literal?: string;
  misc?: {
    strokeCounts?: number[];
    jlptLevel?: number | null;
    grade?: number | null;
    frequency?: number | null;
  };
  readingMeaning?: {
    groups?: Group[];
  };
  // Alternate flat shape (compat with other dumps)
  character?: string;
  stroke_count?: number;
  strokes?: number;
  jlpt?: number | null;
  jlpt_level?: number | null;
  grade?: number | null;
  frequency?: number | null;
  freq?: number | null;
  on_readings?: string[];
  kun_readings?: string[];
  readings_on?: string[];
  readings_kun?: string[];
}

interface KanjidicFile {
  characters?: KanjidicEntry[];
  kanji?: KanjidicEntry[];
}

function normalizeEntry(e: KanjidicEntry) {
  const character = e.literal ?? e.character;
  if (!character) return null;

  const strokeCount =
    e.misc?.strokeCounts?.[0] ?? e.stroke_count ?? e.strokes ?? null;
  const jlptLevel = e.misc?.jlptLevel ?? e.jlpt ?? e.jlpt_level ?? null;
  const grade = e.misc?.grade ?? e.grade ?? null;
  const frequency = e.misc?.frequency ?? e.frequency ?? e.freq ?? null;

  let on: string[] = e.on_readings ?? e.readings_on ?? [];
  let kun: string[] = e.kun_readings ?? e.readings_kun ?? [];

  if (on.length === 0 && kun.length === 0 && e.readingMeaning?.groups) {
    const onSet: string[] = [];
    const kunSet: string[] = [];
    for (const group of e.readingMeaning.groups) {
      for (const r of group.readings ?? []) {
        if (r.type === 'ja_on' && !onSet.includes(r.value)) onSet.push(r.value);
        if (r.type === 'ja_kun' && !kunSet.includes(r.value)) kunSet.push(r.value);
      }
    }
    on = onSet;
    kun = kunSet;
  }

  return { character, strokeCount, jlptLevel, grade, frequency, on, kun };
}

async function main() {
  const dataPath =
    process.env.KANJIDIC_PATH ?? join(__dirname, 'data', 'kanjidic2.json');

  if (!existsSync(dataPath)) {
    console.error(`KANJIDIC2 JSON not found at: ${dataPath}`);
    console.error('Download from e.g. https://github.com/scriptin/kanjidic2-json');
    console.error('and place the JSON at apps/web/scripts/data/kanjidic2.json');
    process.exit(1);
  }

  const raw = readFileSync(dataPath, 'utf-8');
  const parsed: KanjidicFile = JSON.parse(raw);
  const entries = parsed.characters ?? parsed.kanji ?? [];
  console.log(`Loaded ${entries.length} kanji entries from ${dataPath}`);

  const BATCH_SIZE = 200;
  let processed = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const normalized = batch
      .map(normalizeEntry)
      .filter((x): x is NonNullable<ReturnType<typeof normalizeEntry>> => x !== null);

    await sql.begin(async (tx) => {
      for (const n of normalized) {
        await tx`
          INSERT INTO kanjis (character, stroke_count, jlpt_level, grade, frequency, source)
          VALUES (${n.character}, ${n.strokeCount}, ${n.jlptLevel}, ${n.grade}, ${n.frequency}, 'kanjidic2')
          ON CONFLICT (character) DO UPDATE SET
            stroke_count = EXCLUDED.stroke_count,
            jlpt_level = EXCLUDED.jlpt_level,
            grade = EXCLUDED.grade,
            frequency = EXCLUDED.frequency
        `;

        await tx`DELETE FROM kanji_readings WHERE character = ${n.character}`;

        const rows: { character: string; reading: string; reading_type: string; position: number }[] = [];
        n.on.forEach((r, idx) => {
          rows.push({ character: n.character, reading: r, reading_type: 'on', position: idx });
        });
        n.kun.forEach((r, idx) => {
          rows.push({ character: n.character, reading: r, reading_type: 'kun', position: idx });
        });

        if (rows.length > 0) {
          await tx`
            INSERT INTO kanji_readings ${tx(rows, 'character', 'reading', 'reading_type', 'position')}
          `;
        }
      }
    });

    processed += normalized.length;
    console.log(`  ${processed}/${entries.length}`);
  }

  console.log('Done.');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
