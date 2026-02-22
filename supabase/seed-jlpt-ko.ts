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
const SYSTEM_USER_PASSWORD =
  process.env.SYSTEM_USER_PASSWORD ?? 'system-seed-password-change-me';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Service role key is required to create system user and bypass RLS.\n' +
      'Get it from: Supabase Dashboard → Settings → API → service_role',
  );
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TRANSLATE_BATCH_SIZE = 50;
const DB_BATCH_SIZE = 500;
const GPT_MODEL = 'gpt-4.1-nano';

// ---------- Types ----------

interface DictEntry {
  term: string;
  reading: string;
  meanings: string[];
  parts_of_speech: string[];
  jlpt_level: number;
}

interface TranslatedWord {
  term: string;
  reading: string;
  meaningKo: string;
  jlptLevel: number;
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
  entries: { term: string; reading: string; meaning_en: string }[],
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

      // Map back by index, fallback to empty string if missing
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

// ---------- System User ----------

async function getOrCreateSystemUser(): Promise<string> {
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers?.users?.find(
    (u) => u.email === SYSTEM_USER_EMAIL,
  );
  if (existing) {
    console.log(`System user exists: ${existing.id}`);
    return existing.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: SYSTEM_USER_EMAIL,
    password: SYSTEM_USER_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`Created system user: ${data.user.id}`);
  return data.user.id;
}

// ---------- Main ----------

async function main() {
  console.log('=== JLPT Korean Wordbook Seed ===\n');

  // 1. Fetch ALL JLPT entries from dictionary_entries (paginate past 1000 limit)
  console.log('Fetching JLPT entries from dictionary_entries...');
  const dictEntries: DictEntry[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  while (true) {
    const { data, error: fetchErr } = await supabase
      .from('dictionary_entries')
      .select('term, reading, meanings, parts_of_speech, jlpt_level')
      .eq('source', 'jlpt-seed')
      .not('jlpt_level', 'is', null)
      .order('jlpt_level', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (fetchErr) throw fetchErr;
    if (!data || data.length === 0) break;

    dictEntries.push(...(data as unknown as DictEntry[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (dictEntries.length === 0) {
    console.error('No JLPT entries found. Run seed:dictionary first.');
    process.exit(1);
  }

  console.log(`Found ${dictEntries.length} JLPT entries\n`);

  // 2. Batch translate to Korean
  console.log(`--- Translating to Korean (${GPT_MODEL}) ---\n`);
  const translated: TranslatedWord[] = [];
  const totalBatches = Math.ceil(
    dictEntries.length / TRANSLATE_BATCH_SIZE,
  );

  for (let i = 0; i < dictEntries.length; i += TRANSLATE_BATCH_SIZE) {
    const batch = dictEntries.slice(i, i + TRANSLATE_BATCH_SIZE);
    const batchNum = Math.floor(i / TRANSLATE_BATCH_SIZE) + 1;

    const input = batch.map((e, idx) => ({
      i: idx,
      term: e.term,
      reading: e.reading,
      meaning_en: (e.meanings as string[]).join(', '),
    }));

    process.stdout.write(
      `  Batch ${batchNum}/${totalBatches} (${batch.length} words)...`,
    );
    const koreanMeanings = await translateBatch(input);
    console.log(' done');

    for (let j = 0; j < batch.length; j++) {
      translated.push({
        term: batch[j].term,
        reading: batch[j].reading,
        meaningKo: koreanMeanings[j] || (batch[j].meanings as string[]).join(', '),
        jlptLevel: batch[j].jlpt_level as number,
      });
    }

    // Small delay between batches
    if (i + TRANSLATE_BATCH_SIZE < dictEntries.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  console.log(`\nTranslated ${translated.length} words\n`);

  // 3. Get/create system user
  const userId = await getOrCreateSystemUser();

  // 4. Create wordbooks and insert words
  const levels = [5, 4, 3, 2, 1] as const;

  for (const level of levels) {
    const wordsForLevel = translated.filter((w) => w.jlptLevel === level);
    if (wordsForLevel.length === 0) continue;

    console.log(`\n--- JLPT N${level}: ${wordsForLevel.length} words ---`);

    // Create or get wordbook
    const wordbookName = `JLPT N${level}`;
    const { data: existingWb } = await supabase
      .from('wordbooks')
      .select('id')
      .eq('user_id', userId)
      .eq('name', wordbookName)
      .eq('is_system', true)
      .single();

    let wordbookId: string;
    if (existingWb) {
      console.log(`  Wordbook "${wordbookName}" exists: ${existingWb.id}`);
      wordbookId = existingWb.id;
    } else {
      const { data: wb, error: wbErr } = await supabase
        .from('wordbooks')
        .insert({
          user_id: userId,
          name: wordbookName,
          description: `JLPT N${level} vocabulary`,
          is_shared: true,
          is_system: true,
        })
        .select('id')
        .single();
      if (wbErr) throw wbErr;
      wordbookId = (wb as { id: string }).id;
      console.log(`  Created wordbook "${wordbookName}": ${wordbookId}`);
    }

    // Batch insert words
    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < wordsForLevel.length; i += DB_BATCH_SIZE) {
      const batch = wordsForLevel.slice(i, i + DB_BATCH_SIZE);
      const wordRows = batch.map((w) => ({
        user_id: userId,
        term: w.term,
        reading: w.reading,
        meaning: w.meaningKo,
        jlpt_level: w.jlptLevel,
        tags: [`jlpt-n${level}`],
      }));

      const { data: insertedWords, error: insertErr } = await supabase
        .from('words')
        .upsert(wordRows, {
          onConflict: 'user_id,term,reading',
          ignoreDuplicates: true,
        })
        .select('id');

      if (insertErr) {
        console.error(`  Insert error: ${insertErr.message}`);
        continue;
      }

      inserted += (insertedWords ?? []).length;
      skipped += batch.length - (insertedWords ?? []).length;
    }

    console.log(`  Words: ${inserted} inserted, ${skipped} skipped`);

    // Link words to wordbook
    // Fetch all word IDs for this level/user (paginate past 1000 limit)
    const levelWords: { id: string }[] = [];
    let linkOffset = 0;
    while (true) {
      const { data } = await supabase
        .from('words')
        .select('id')
        .eq('user_id', userId)
        .contains('tags', [`jlpt-n${level}`])
        .range(linkOffset, linkOffset + PAGE_SIZE - 1);
      if (!data || data.length === 0) break;
      levelWords.push(...(data as { id: string }[]));
      if (data.length < PAGE_SIZE) break;
      linkOffset += PAGE_SIZE;
    }

    if (levelWords && levelWords.length > 0) {
      let linked = 0;
      for (let i = 0; i < levelWords.length; i += DB_BATCH_SIZE) {
        const batch = levelWords.slice(i, i + DB_BATCH_SIZE);
        const links = batch.map((w) => ({
          wordbook_id: wordbookId,
          word_id: (w as { id: string }).id,
        }));

        const { error: linkErr } = await supabase
          .from('wordbook_items')
          .upsert(links, {
            onConflict: 'wordbook_id,word_id',
            ignoreDuplicates: true,
          });

        if (linkErr) {
          console.error(`  Link error: ${linkErr.message}`);
        } else {
          linked += batch.length;
        }
      }
      console.log(`  Linked ${linked} words to wordbook`);
    }
  }

  // 5. Summary
  const { count: totalWords } = await supabase
    .from('words')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const { count: totalWordbooks } = await supabase
    .from('wordbooks')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_system', true);

  console.log(`\n=== Done ===`);
  console.log(`System wordbooks: ${totalWordbooks}`);
  console.log(`System words: ${totalWords}`);
}

main().catch((err) => {
  console.error('\nSeed failed:', err);
  process.exit(1);
});
