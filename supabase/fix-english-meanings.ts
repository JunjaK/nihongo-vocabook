/**
 * fix-english-meanings.ts
 *
 * Finds system JLPT words whose `meaning` field is still in English
 * (not Korean) and translates them to Korean using GPT.
 *
 * Usage:
 *   npx tsx supabase/fix-english-meanings.ts          # dry-run (shows what would change)
 *   npx tsx supabase/fix-english-meanings.ts --apply   # actually updates the DB
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------- Load .env.local ----------

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
  // .env.local not found
}

// ---------- Config ----------

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY ?? process.env.NEXT_PRIVATE_OPENAI_API_KEY;
const SYSTEM_USER_EMAIL =
  process.env.SYSTEM_USER_EMAIL ?? 'system@nihongo-vocabook.local';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const GPT_MODEL = 'gpt-4.1-nano';
const TRANSLATE_BATCH_SIZE = 50;
const DRY_RUN = !process.argv.includes('--apply');

// ---------- Detect English ----------

/**
 * A meaning is likely English if:
 * - It contains mostly ASCII letters (latin alphabet)
 * - It does NOT contain any Hangul (Korean) characters
 */
function isEnglishMeaning(meaning: string): boolean {
  // Has Korean → not English
  if (/[\uAC00-\uD7AF\u3131-\u3163\u3200-\u321E]/.test(meaning)) return false;

  // Has significant Latin text → likely English
  const latinChars = meaning.replace(/[^a-zA-Z]/g, '').length;
  return latinChars >= 3;
}

// ---------- GPT Translation ----------

const SYSTEM_PROMPT = `You are a Japanese-Korean vocabulary translator.
Given Japanese words with readings and English meanings, provide natural, concise Korean translations.

Output JSON: {"translations": [{"i": 0, "ko": "한국어 뜻"}, ...]}

Rules:
- Verbs: dictionary form (먹다, 가다)
- い-adjectives: dictionary form (크다, 예쁘다)
- な-adjectives: include 하다 if natural (조용하다) or noun form (친절)
- Nouns: just the Korean word
- 1~3 meanings, separated by ", "
- Match input order exactly by index`;

async function translateBatch(
  entries: { i: number; term: string; reading: string; meaning_en: string }[],
  retries = 3,
): Promise<string[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: GPT_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(entries) },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        if (res.status === 429 && attempt < retries - 1) {
          const wait = Math.pow(2, attempt) * 2000;
          console.warn(`  Rate limited, waiting ${wait}ms...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw new Error(`OpenAI API ${res.status}: ${body}`);
      }

      const data = await res.json();
      const content = data.choices[0].message.content;
      const parsed = JSON.parse(content);
      const translations: { i: number; ko: string }[] = parsed.translations;

      return entries.map((_, idx) => {
        const found = translations.find((t) => t.i === idx);
        return found?.ko ?? '';
      });
    } catch (err) {
      if (attempt < retries - 1) {
        console.warn(`  Retry ${attempt + 1}: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unreachable');
}

// ---------- Main ----------

interface WordRow {
  id: string;
  term: string;
  reading: string;
  meaning: string;
  jlpt_level: number | null;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (use --apply to update DB) ===' : '=== APPLYING CHANGES ===');
  console.log();

  // 1. Find system user
  const { data: users } = await supabase.auth.admin.listUsers();
  const systemUser = users?.users?.find((u) => u.email === SYSTEM_USER_EMAIL);
  if (!systemUser) {
    console.error(`System user (${SYSTEM_USER_EMAIL}) not found`);
    process.exit(1);
  }
  console.log(`System user: ${systemUser.id}`);

  // 2. Fetch ALL system words (paginate past 1000)
  const allWords: WordRow[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('words')
      .select('id, term, reading, meaning, jlpt_level')
      .eq('user_id', systemUser.id)
      .not('jlpt_level', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    allWords.push(...(data as WordRow[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(`Total system JLPT words: ${allWords.length}`);

  // 3. Filter words with English meanings
  const englishWords = allWords.filter((w) => isEnglishMeaning(w.meaning));
  console.log(`Words with English meanings: ${englishWords.length}\n`);

  if (englishWords.length === 0) {
    console.log('Nothing to fix!');
    return;
  }

  // Show samples
  console.log('Sample English meanings found:');
  for (const w of englishWords.slice(0, 10)) {
    console.log(`  ${w.term} (${w.reading}) → "${w.meaning}"`);
  }
  if (englishWords.length > 10) {
    console.log(`  ... and ${englishWords.length - 10} more`);
  }
  console.log();

  if (DRY_RUN) {
    console.log('Run with --apply to translate and update these words.');
    return;
  }

  // 4. Translate in batches
  console.log('Translating to Korean...\n');
  const updates: { id: string; meaning: string }[] = [];
  const totalBatches = Math.ceil(englishWords.length / TRANSLATE_BATCH_SIZE);

  for (let i = 0; i < englishWords.length; i += TRANSLATE_BATCH_SIZE) {
    const batch = englishWords.slice(i, i + TRANSLATE_BATCH_SIZE);
    const batchNum = Math.floor(i / TRANSLATE_BATCH_SIZE) + 1;

    const input = batch.map((w, idx) => ({
      i: idx,
      term: w.term,
      reading: w.reading,
      meaning_en: w.meaning,
    }));

    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} words)...`);
    const koreanMeanings = await translateBatch(input);
    console.log(' done');

    for (let j = 0; j < batch.length; j++) {
      const ko = koreanMeanings[j];
      if (ko) {
        updates.push({ id: batch[j].id, meaning: ko });
      } else {
        console.warn(`  ⚠ No translation for: ${batch[j].term}`);
      }
    }

    if (i + TRANSLATE_BATCH_SIZE < englishWords.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // 5. Update DB
  console.log(`\nUpdating ${updates.length} words in DB...`);
  let updated = 0;
  let failed = 0;

  for (const { id, meaning } of updates) {
    const { error } = await supabase
      .from('words')
      .update({ meaning })
      .eq('id', id);

    if (error) {
      console.error(`  Failed to update ${id}: ${error.message}`);
      failed++;
    } else {
      updated++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Updated: ${updated}`);
  if (failed > 0) console.log(`Failed: ${failed}`);

  // Show some results
  console.log('\nSample updates:');
  for (const u of updates.slice(0, 10)) {
    const original = englishWords.find((w) => w.id === u.id);
    console.log(`  ${original?.term}: "${original?.meaning}" → "${u.meaning}"`);
  }
}

main().catch((err) => {
  console.error('\nScript failed:', err);
  process.exit(1);
});
