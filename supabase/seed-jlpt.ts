import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SYSTEM_USER_EMAIL = process.env.SYSTEM_USER_EMAIL ?? 'system@nihongo-vocabook.local';
const SYSTEM_USER_PASSWORD = process.env.SYSTEM_USER_PASSWORD ?? 'system-seed-password-change-me';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface JlptWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number;
}

const LEVELS = [5, 4, 3, 2, 1] as const;

async function getOrCreateSystemUser(): Promise<string> {
  // Check if user already exists
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === SYSTEM_USER_EMAIL);
  if (existing) {
    console.log(`System user already exists: ${existing.id}`);
    return existing.id;
  }

  // Create system user
  const { data, error } = await supabase.auth.admin.createUser({
    email: SYSTEM_USER_EMAIL,
    password: SYSTEM_USER_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`Created system user: ${data.user.id}`);
  return data.user.id;
}

async function seedLevel(userId: string, level: number): Promise<void> {
  const dataPath = resolve(__dirname, `data/jlpt-n${level}.json`);
  const words: JlptWord[] = JSON.parse(readFileSync(dataPath, 'utf-8'));

  const wordbookName = `JLPT N${level}`;

  // Check if wordbook already exists
  const { data: existingWb } = await supabase
    .from('wordbooks')
    .select('id')
    .eq('user_id', userId)
    .eq('name', wordbookName)
    .eq('is_system', true)
    .single();

  let wordbookId: string;

  if (existingWb) {
    console.log(`Wordbook "${wordbookName}" already exists, skipping creation`);
    wordbookId = existingWb.id;
  } else {
    const { data: wb, error: wbError } = await supabase
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
    if (wbError) throw wbError;
    wordbookId = wb.id;
    console.log(`Created wordbook "${wordbookName}": ${wordbookId}`);
  }

  // Get existing words for this user to dedup
  const { data: existingWords } = await supabase
    .from('words')
    .select('id, term, reading')
    .eq('user_id', userId);

  const existingMap = new Map(
    (existingWords ?? []).map((w: { id: string; term: string; reading: string }) => [
      `${w.term}|${w.reading}`,
      w.id,
    ]),
  );

  let inserted = 0;
  let skipped = 0;

  for (const word of words) {
    const key = `${word.term}|${word.reading}`;
    let wordId = existingMap.get(key);

    if (!wordId) {
      const { data: newWord, error: wordError } = await supabase
        .from('words')
        .insert({
          user_id: userId,
          term: word.term,
          reading: word.reading,
          meaning: word.meaning,
          jlpt_level: word.jlptLevel,
          tags: [`jlpt-n${level}`],
        })
        .select('id')
        .single();
      if (wordError) throw wordError;
      const newWordId = (newWord as { id: string }).id;
      wordId = newWordId;
      existingMap.set(key, newWordId);
      inserted++;
    } else {
      skipped++;
    }

    // Link to wordbook (ignore duplicate errors)
    const { error: linkError } = await supabase
      .from('wordbook_items')
      .insert({ wordbook_id: wordbookId, word_id: wordId! });
    if (linkError && linkError.code !== '23505') throw linkError;
  }

  console.log(`  N${level}: ${inserted} words inserted, ${skipped} skipped (already exist)`);
}

async function main() {
  console.log('Seeding JLPT wordbooks...\n');

  const userId = await getOrCreateSystemUser();

  for (const level of LEVELS) {
    await seedLevel(userId, level);
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
