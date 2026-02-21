'use client';

import { db } from '@/lib/db/dexie';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function getLocalWordCount(): Promise<number> {
  return db.words.count();
}

export async function migrateToSupabase(supabase: SupabaseClient): Promise<{
  wordCount: number;
  progressCount: number;
}> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user!.id;

  const localWords = await db.words.toArray();
  const localProgress = await db.studyProgress.toArray();
  const localWordbooks = await db.wordbooks.toArray();
  const localWordbookItems = await db.wordbookItems.toArray();

  let wordCount = 0;
  let progressCount = 0;
  const wordIdMap = new Map<number, string>();

  for (const word of localWords) {
    const { data: inserted, error } = await supabase
      .from('words')
      .insert({
        user_id: userId,
        term: word.term,
        reading: word.reading,
        meaning: word.meaning,
        notes: word.notes,
        tags: word.tags,
        jlpt_level: word.jlptLevel,
        mastered: word.mastered ?? false,
        mastered_at: word.masteredAt?.toISOString() ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to migrate word:', word.term, error);
      continue;
    }

    wordCount++;
    wordIdMap.set(word.id!, inserted.id);

    const progress = localProgress.find((p) => p.wordId === word.id!);
    if (progress) {
      const { error: progressError } = await supabase
        .from('study_progress')
        .insert({
          user_id: userId,
          word_id: inserted.id,
          next_review: progress.nextReview.toISOString(),
          interval_days: progress.intervalDays,
          ease_factor: progress.easeFactor,
          review_count: progress.reviewCount,
          last_reviewed_at: progress.lastReviewedAt?.toISOString() ?? null,
        });

      if (!progressError) progressCount++;
    }
  }

  // Migrate wordbooks
  const wordbookIdMap = new Map<number, string>();
  for (const wb of localWordbooks) {
    const { data: inserted, error } = await supabase
      .from('wordbooks')
      .insert({
        user_id: userId,
        name: wb.name,
        description: wb.description,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to migrate wordbook:', wb.name, error);
      continue;
    }
    wordbookIdMap.set(wb.id!, inserted.id);
  }

  // Migrate wordbook items
  for (const item of localWordbookItems) {
    const wordbookId = wordbookIdMap.get(item.wordbookId);
    const wordId = wordIdMap.get(item.wordId);
    if (wordbookId && wordId) {
      await supabase
        .from('wordbook_items')
        .insert({ wordbook_id: wordbookId, word_id: wordId });
    }
  }

  // Clear local data after successful migration
  await db.wordbookItems.clear();
  await db.wordbooks.clear();
  await db.studyProgress.clear();
  await db.words.clear();

  return { wordCount, progressCount };
}
