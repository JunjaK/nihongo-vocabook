import type { SupabaseClient } from '@supabase/supabase-js';
import { reviewCard, createInitialProgress, isNewCard } from '@/lib/spaced-repetition';
import { getLocalDateString } from '@/lib/quiz/date-utils';
import type {
  Word,
  CreateWordInput,
  UpdateWordInput,
  StudyProgress,
  WordWithProgress,
  ExportData,
  ImportData,
} from '@/types/word';
import type {
  Wordbook,
  CreateWordbookInput,
  UpdateWordbookInput,
  WordbookWithCount,
  SharedWordbookListItem,
} from '@/types/wordbook';
import type { QuizSettings, DailyStats, Achievement } from '@/types/quiz';
import { DEFAULT_QUIZ_SETTINGS } from '@/types/quiz';
import type {
  DataRepository,
  WordRepository,
  StudyRepository,
  WordbookRepository,
} from './types';

interface DbWord {
  id: string;
  user_id: string;
  term: string;
  reading: string;
  meaning: string;
  notes: string | null;
  tags: string[];
  jlpt_level: number | null;
  priority: number;
  mastered: boolean;
  mastered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DbStudyProgress {
  id: string;
  user_id: string;
  word_id: string;
  next_review: string;
  interval_days: number;
  ease_factor: number;
  review_count: number;
  last_reviewed_at: string | null;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  lapses: number;
  card_state: number;
}

interface DbWordbook {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_shared: boolean;
  is_system: boolean;
  tags: string[];
  import_count: number;
  created_at: string;
  updated_at: string;
}

interface DbWordbookItem {
  id: string;
  wordbook_id: string;
  word_id: string;
  added_at: string;
}

function dbWordToWord(row: DbWord): Word {
  return {
    id: row.id,
    term: row.term,
    reading: row.reading,
    meaning: row.meaning,
    notes: row.notes,
    tags: row.tags,
    jlptLevel: row.jlpt_level,
    priority: row.priority ?? 2,
    mastered: row.mastered ?? false,
    masteredAt: row.mastered_at ? new Date(row.mastered_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function dbProgressToProgress(row: DbStudyProgress): StudyProgress {
  return {
    id: row.id,
    wordId: row.word_id,
    nextReview: new Date(row.next_review),
    intervalDays: row.interval_days,
    easeFactor: row.ease_factor,
    reviewCount: row.review_count,
    lastReviewedAt: row.last_reviewed_at
      ? new Date(row.last_reviewed_at)
      : null,
    stability: row.stability ?? 0,
    difficulty: row.difficulty ?? 0,
    elapsedDays: row.elapsed_days ?? 0,
    scheduledDays: row.scheduled_days ?? 0,
    learningSteps: row.learning_steps ?? 0,
    lapses: row.lapses ?? 0,
    cardState: row.card_state ?? 0,
  };
}

function dbWordbookToWordbook(row: DbWordbook): Wordbook {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    isShared: row.is_shared ?? false,
    isSystem: row.is_system ?? false,
    tags: row.tags ?? [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

class SupabaseWordRepository implements WordRepository {
  constructor(private supabase: SupabaseClient) {}

  async getAll(): Promise<Word[]> {
    const { data, error } = await this.supabase
      .from('words')
      .select('*')
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as DbWord[]).map(dbWordToWord);
  }

  async getNonMastered(): Promise<Word[]> {
    const { data, error } = await this.supabase
      .from('words')
      .select('*')
      .eq('mastered', false)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as DbWord[]).map(dbWordToWord);
  }

  async getMastered(): Promise<Word[]> {
    const { data, error } = await this.supabase
      .from('words')
      .select('*')
      .eq('mastered', true)
      .order('mastered_at', { ascending: false });
    if (error) throw error;
    return (data as DbWord[]).map(dbWordToWord);
  }

  async getById(id: string): Promise<Word | null> {
    const { data, error } = await this.supabase
      .from('words')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return dbWordToWord(data as DbWord);
  }

  async search(query: string): Promise<Word[]> {
    const { data, error } = await this.supabase
      .from('words')
      .select('*')
      .or(`term.ilike.%${query}%,reading.ilike.%${query}%,meaning.ilike.%${query}%`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as DbWord[]).map(dbWordToWord);
  }

  async create(input: CreateWordInput): Promise<Word> {
    const { data: userData } = await this.supabase.auth.getUser();
    const { data, error } = await this.supabase
      .from('words')
      .insert({
        user_id: userData.user!.id,
        term: input.term,
        reading: input.reading,
        meaning: input.meaning,
        notes: input.notes ?? null,
        tags: input.tags ?? [],
        jlpt_level: input.jlptLevel ?? null,
        priority: input.priority ?? 2,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('DUPLICATE_WORD');
      throw error;
    }
    return dbWordToWord(data as DbWord);
  }

  async update(id: string, input: UpdateWordInput): Promise<Word> {
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.term !== undefined) updateData.term = input.term;
    if (input.reading !== undefined) updateData.reading = input.reading;
    if (input.meaning !== undefined) updateData.meaning = input.meaning;
    if (input.notes !== undefined) updateData.notes = input.notes;
    if (input.tags !== undefined) updateData.tags = input.tags;
    if (input.jlptLevel !== undefined) updateData.jlpt_level = input.jlptLevel;
    if (input.priority !== undefined) updateData.priority = input.priority;

    const { data, error } = await this.supabase
      .from('words')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('DUPLICATE_WORD');
      throw error;
    }
    return dbWordToWord(data as DbWord);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from('words').delete().eq('id', id);
    if (error) throw error;
  }

  async setMastered(id: string, mastered: boolean): Promise<Word> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('words')
      .update({
        mastered,
        mastered_at: mastered ? now : null,
        updated_at: now,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    if (mastered) {
      await this.supabase
        .from('wordbook_items')
        .delete()
        .eq('word_id', id);
    }

    return dbWordToWord(data as DbWord);
  }
}

class SupabaseStudyRepository implements StudyRepository {
  constructor(private supabase: SupabaseClient) {}

  async getProgress(wordId: string): Promise<StudyProgress | null> {
    const { data, error } = await this.supabase
      .from('study_progress')
      .select('*')
      .eq('word_id', wordId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return dbProgressToProgress(data as DbStudyProgress);
  }

  async getDueCount(): Promise<number> {
    const now = new Date().toISOString();

    const { count: dueWithProgress, error: e1 } = await this.supabase
      .from('study_progress')
      .select('*, words!inner(*)', { count: 'exact', head: true })
      .lte('next_review', now)
      .eq('words.mastered', false);
    if (e1) throw e1;

    const { count: noProgress, error: e2 } = await this.supabase
      .from('words')
      .select('*, study_progress(*)', { count: 'exact', head: true })
      .eq('mastered', false)
      .is('study_progress', null);
    if (e2) throw e2;

    return (dueWithProgress ?? 0) + (noProgress ?? 0);
  }

  async getDueWords(limit = 20): Promise<WordWithProgress[]> {
    const now = new Date().toISOString();

    const { data: dueProgress, error: progressError } = await this.supabase
      .from('study_progress')
      .select('*, words(*)')
      .lte('next_review', now)
      .limit(limit);
    if (progressError) throw progressError;

    const result: WordWithProgress[] = (dueProgress ?? [])
      .filter((row) => {
        const word = (row as Record<string, unknown>).words as DbWord;
        return !word.mastered;
      })
      .map((row) => ({
        ...dbWordToWord((row as Record<string, unknown>).words as DbWord),
        progress: dbProgressToProgress(row as unknown as DbStudyProgress),
      }));

    if (result.length < limit) {
      const { data: allWords, error: wordsError } = await this.supabase
        .from('words')
        .select('*, study_progress(*)')
        .eq('mastered', false)
        .is('study_progress', null)
        .limit(limit - result.length);
      if (wordsError) throw wordsError;

      for (const row of allWords ?? []) {
        result.push({
          ...dbWordToWord(row as unknown as DbWord),
          progress: null,
        });
      }
    }

    return result;
  }

  async recordReview(wordId: string, quality: number): Promise<void> {
    const existing = await this.getProgress(wordId);
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const wasNew = isNewCard(existing);

    if (existing) {
      const updated = reviewCard(quality, existing);
      const { error } = await this.supabase
        .from('study_progress')
        .update({
          next_review: updated.nextReview.toISOString(),
          interval_days: updated.intervalDays,
          ease_factor: updated.easeFactor,
          review_count: updated.reviewCount,
          last_reviewed_at: updated.lastReviewedAt?.toISOString() ?? null,
          stability: updated.stability,
          difficulty: updated.difficulty,
          elapsed_days: updated.elapsedDays,
          scheduled_days: updated.scheduledDays,
          learning_steps: updated.learningSteps,
          lapses: updated.lapses,
          card_state: updated.cardState,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const initial = createInitialProgress(wordId);
      const updated = reviewCard(quality, initial);
      const { error } = await this.supabase.from('study_progress').insert({
        user_id: userId,
        word_id: wordId,
        next_review: updated.nextReview.toISOString(),
        interval_days: updated.intervalDays,
        ease_factor: updated.easeFactor,
        review_count: updated.reviewCount,
        last_reviewed_at: updated.lastReviewedAt?.toISOString() ?? null,
        stability: updated.stability,
        difficulty: updated.difficulty,
        elapsed_days: updated.elapsedDays,
        scheduled_days: updated.scheduledDays,
        learning_steps: updated.learningSteps,
        lapses: updated.lapses,
        card_state: updated.cardState,
      });
      if (error) throw error;
    }

    // Track daily stats
    const today = getLocalDateString();
    await this.incrementDailyStats(today, wasNew, quality === 0);

    // Upgrade priority to high when rated "Again"
    if (quality === 0) {
      await this.supabase
        .from('words')
        .update({ priority: 1 })
        .eq('id', wordId)
        .gt('priority', 1);
    }
  }

  async getQuizSettings(): Promise<QuizSettings> {
    const { data, error } = await this.supabase
      .from('quiz_settings')
      .select('*')
      .single();
    if (error) {
      if (error.code === 'PGRST116') return { ...DEFAULT_QUIZ_SETTINGS };
      throw error;
    }
    return {
      newPerDay: data.new_per_day,
      maxReviewsPerDay: data.max_reviews_per_day,
      jlptFilter: data.jlpt_filter,
      priorityFilter: data.priority_filter,
      newCardOrder: data.new_card_order,
    };
  }

  async updateQuizSettings(settings: Partial<QuizSettings>): Promise<void> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (settings.newPerDay !== undefined) updateData.new_per_day = settings.newPerDay;
    if (settings.maxReviewsPerDay !== undefined) updateData.max_reviews_per_day = settings.maxReviewsPerDay;
    if (settings.jlptFilter !== undefined) updateData.jlpt_filter = settings.jlptFilter;
    if (settings.priorityFilter !== undefined) updateData.priority_filter = settings.priorityFilter;
    if (settings.newCardOrder !== undefined) updateData.new_card_order = settings.newCardOrder;

    const { error } = await this.supabase
      .from('quiz_settings')
      .upsert({ user_id: userId, ...updateData }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  async getDailyStats(date: string): Promise<DailyStats | null> {
    const { data, error } = await this.supabase
      .from('daily_stats')
      .select('*')
      .eq('stat_date', date)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return {
      id: data.id,
      date: data.stat_date,
      newCount: data.new_count,
      reviewCount: data.review_count,
      againCount: data.again_count,
    };
  }

  async incrementDailyStats(date: string, isNew: boolean, isAgain: boolean): Promise<void> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const existing = await this.getDailyStats(date);
    if (existing) {
      const { error } = await this.supabase
        .from('daily_stats')
        .update({
          new_count: existing.newCount + (isNew ? 1 : 0),
          review_count: existing.reviewCount + 1,
          again_count: existing.againCount + (isAgain ? 1 : 0),
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await this.supabase
        .from('daily_stats')
        .insert({
          user_id: userId,
          stat_date: date,
          new_count: isNew ? 1 : 0,
          review_count: 1,
          again_count: isAgain ? 1 : 0,
        });
      if (error) throw error;
    }
  }

  async getStreakDays(): Promise<number> {
    const { data, error } = await this.supabase
      .from('daily_stats')
      .select('stat_date')
      .order('stat_date', { ascending: false })
      .limit(100);
    if (error) throw error;
    if (!data || data.length === 0) return 0;

    let streak = 0;
    let checkDate = getLocalDateString();

    // If today has no stats, check if yesterday does (streak not broken yet today)
    if (data[0].stat_date !== checkDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      checkDate = getLocalDateString(yesterday);
      if (data[0].stat_date !== checkDate) return 0;
    }

    const dateSet = new Set(data.map((d: { stat_date: string }) => d.stat_date));
    const current = new Date(checkDate + 'T00:00:00');
    while (dateSet.has(getLocalDateString(current))) {
      streak++;
      current.setDate(current.getDate() - 1);
    }

    return streak;
  }

  async getAchievements(): Promise<Achievement[]> {
    const { data, error } = await this.supabase
      .from('achievements')
      .select('*')
      .order('unlocked_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((a: { id: string; type: string; unlocked_at: string }) => ({
      id: a.id,
      type: a.type as Achievement['type'],
      unlockedAt: new Date(a.unlocked_at),
    }));
  }

  async unlockAchievement(type: string): Promise<Achievement | null> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const { data, error } = await this.supabase
      .from('achievements')
      .insert({ user_id: userId, type })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return null; // already unlocked
      throw error;
    }
    return {
      id: data.id,
      type: data.type as Achievement['type'],
      unlockedAt: new Date(data.unlocked_at),
    };
  }
}

class SupabaseWordbookRepository implements WordbookRepository {
  constructor(private supabase: SupabaseClient) {}

  async getAll(): Promise<WordbookWithCount[]> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const { data, error } = await this.supabase
      .from('wordbooks')
      .select('*, wordbook_items(count)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const results: WordbookWithCount[] = [];
    for (const row of data ?? []) {
      const wb = row as unknown as DbWordbook & {
        wordbook_items: [{ count: number }];
      };
      const wordCount = wb.wordbook_items[0]?.count ?? 0;

      // Count mastered words in this wordbook
      let masteredCount = 0;
      if (wordCount > 0) {
        const { count, error: mcErr } = await this.supabase
          .from('wordbook_items')
          .select('word_id, words!inner(mastered)', { count: 'exact', head: true })
          .eq('wordbook_id', wb.id)
          .eq('words.mastered', true);
        if (!mcErr) masteredCount = count ?? 0;
      }

      results.push({
        ...dbWordbookToWordbook(wb),
        wordCount,
        importCount: wb.import_count ?? 0,
        masteredCount,
      });
    }

    return results;
  }

  async getById(id: string): Promise<Wordbook | null> {
    const { data, error } = await this.supabase
      .from('wordbooks')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return dbWordbookToWordbook(data as DbWordbook);
  }

  async create(input: CreateWordbookInput): Promise<Wordbook> {
    const { data: userData } = await this.supabase.auth.getUser();
    const { data, error } = await this.supabase
      .from('wordbooks')
      .insert({
        user_id: userData.user!.id,
        name: input.name,
        description: input.description ?? null,
        is_shared: input.isShared ?? false,
        tags: input.tags ?? [],
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('DUPLICATE_WORDBOOK');
      throw error;
    }
    return dbWordbookToWordbook(data as DbWordbook);
  }

  async update(id: string, input: UpdateWordbookInput): Promise<Wordbook> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.isShared !== undefined) updateData.is_shared = input.isShared;
    if (input.tags !== undefined) updateData.tags = input.tags;

    const { data, error } = await this.supabase
      .from('wordbooks')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return dbWordbookToWordbook(data as DbWordbook);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('wordbooks')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  async getWords(wordbookId: string): Promise<Word[]> {
    const { data, error } = await this.supabase
      .from('wordbook_items')
      .select('word_id, words(*)')
      .eq('wordbook_id', wordbookId);
    if (error) throw error;
    return (data ?? []).map((row) =>
      dbWordToWord((row as Record<string, unknown>).words as DbWord),
    );
  }

  async addWord(wordbookId: string, wordId: string): Promise<void> {
    const { data: wordData, error: wordError } = await this.supabase
      .from('words')
      .select('mastered')
      .eq('id', wordId)
      .single();
    if (wordError) throw wordError;
    if ((wordData as { mastered: boolean }).mastered) {
      throw new Error('Cannot add mastered word to wordbook');
    }

    const { error } = await this.supabase
      .from('wordbook_items')
      .insert({ wordbook_id: wordbookId, word_id: wordId });
    if (error) {
      if (error.code === '23505') return;
      throw error;
    }
  }

  async removeWord(wordbookId: string, wordId: string): Promise<void> {
    const { error } = await this.supabase
      .from('wordbook_items')
      .delete()
      .eq('wordbook_id', wordbookId)
      .eq('word_id', wordId);
    if (error) throw error;
  }

  async getWordbooksForWord(wordId: string): Promise<Wordbook[]> {
    const { data, error } = await this.supabase
      .from('wordbook_items')
      .select('wordbook_id, wordbooks(*)')
      .eq('word_id', wordId);
    if (error) throw error;
    return (data ?? []).map((row) =>
      dbWordbookToWordbook(
        (row as Record<string, unknown>).wordbooks as DbWordbook,
      ),
    );
  }

  async getSubscribed(): Promise<WordbookWithCount[]> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const { data, error } = await this.supabase
      .from('wordbook_subscriptions')
      .select('wordbook_id, wordbooks(*, wordbook_items(count))')
      .eq('subscriber_id', userId);
    if (error) throw error;

    return (data ?? []).map((row) => {
      const wb = (row as Record<string, unknown>).wordbooks as unknown as DbWordbook & {
        wordbook_items: [{ count: number }];
      };
      return {
        ...dbWordbookToWordbook(wb),
        wordCount: wb.wordbook_items[0]?.count ?? 0,
        importCount: wb.import_count ?? 0,
        masteredCount: 0,
      };
    });
  }

  async browseShared(): Promise<SharedWordbookListItem[]> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const { data, error } = await this.supabase
      .from('wordbooks')
      .select('*, wordbook_items(count), wordbook_subscriptions(subscriber_id)')
      .eq('is_shared', true)
      .neq('user_id', userId)
      .order('is_system', { ascending: false })
      .order('import_count', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;

    const results: SharedWordbookListItem[] = [];
    for (const row of data ?? []) {
      const wb = row as unknown as DbWordbook & {
        wordbook_items: [{ count: number }];
        wordbook_subscriptions: Array<{ subscriber_id: string }>;
      };

      const { data: emailData } = await this.supabase
        .rpc('get_user_email', { uid: wb.user_id });

      const isSubscribed = wb.wordbook_subscriptions.some(
        (s) => s.subscriber_id === userId,
      );

      results.push({
        ...dbWordbookToWordbook(wb),
        wordCount: wb.wordbook_items[0]?.count ?? 0,
        importCount: wb.import_count ?? 0,
        masteredCount: 0,
        ownerEmail: (emailData as string) ?? '',
        isSubscribed,
      });
    }

    return results;
  }

  async subscribe(wordbookId: string): Promise<void> {
    const { data: userData } = await this.supabase.auth.getUser();
    const { error } = await this.supabase
      .from('wordbook_subscriptions')
      .insert({
        wordbook_id: wordbookId,
        subscriber_id: userData.user!.id,
      });
    if (error) {
      if (error.code === '23505') return;
      throw error;
    }

    await this.incrementImportCount(wordbookId);
  }

  private async incrementImportCount(wordbookId: string): Promise<void> {
    const { data } = await this.supabase
      .from('wordbooks')
      .select('import_count')
      .eq('id', wordbookId)
      .single();
    const current = (data as { import_count: number } | null)?.import_count ?? 0;
    await this.supabase
      .from('wordbooks')
      .update({ import_count: current + 1 })
      .eq('id', wordbookId);
  }

  async unsubscribe(wordbookId: string): Promise<void> {
    const { data: userData } = await this.supabase.auth.getUser();
    const { error } = await this.supabase
      .from('wordbook_subscriptions')
      .delete()
      .eq('wordbook_id', wordbookId)
      .eq('subscriber_id', userData.user!.id);
    if (error) throw error;
  }

  async copySharedWordbook(wordbookId: string): Promise<Wordbook> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const source = await this.getById(wordbookId);
    if (!source) throw new Error('Wordbook not found');

    const sourceWords = await this.getWords(wordbookId);

    const newWb = await this.create({
      name: source.name,
      description: source.description,
    });

    const { data: existingWords } = await this.supabase
      .from('words')
      .select('id, term, reading')
      .eq('user_id', userId);

    const existingMap = new Map(
      (existingWords ?? []).map((w: { id: string; term: string; reading: string }) =>
        [`${w.term}|${w.reading}`, w.id],
      ),
    );

    for (const word of sourceWords) {
      const key = `${word.term}|${word.reading}`;
      let wordId = existingMap.get(key);

      if (!wordId) {
        const created = await this.supabase
          .from('words')
          .insert({
            user_id: userId,
            term: word.term,
            reading: word.reading,
            meaning: word.meaning,
            notes: word.notes,
            tags: word.tags,
            jlpt_level: word.jlptLevel,
          })
          .select('id')
          .single();
        if (created.error) throw created.error;
        wordId = (created.data as { id: string }).id;
        existingMap.set(key, wordId);
      }

      await this.supabase
        .from('wordbook_items')
        .insert({ wordbook_id: newWb.id, word_id: wordId })
        .select()
        .single()
        .then(({ error }) => {
          if (error && error.code !== '23505') throw error;
        });
    }

    await this.incrementImportCount(wordbookId);

    return newWb;
  }
}

export class SupabaseRepository implements DataRepository {
  words: WordRepository;
  study: StudyRepository;
  wordbooks: WordbookRepository;

  constructor(private supabase: SupabaseClient) {
    this.words = new SupabaseWordRepository(supabase);
    this.study = new SupabaseStudyRepository(supabase);
    this.wordbooks = new SupabaseWordbookRepository(supabase);
  }

  async exportAll(): Promise<ExportData> {
    const words = await this.words.getAll();
    const studyProgress: StudyProgress[] = [];
    for (const word of words) {
      const progress = await this.study.getProgress(word.id);
      if (progress) studyProgress.push(progress);
    }

    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const { data: wbData } = await this.supabase
      .from('wordbooks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    const wordbooks = (wbData ?? []).map((wb: DbWordbook) => ({
      id: wb.id,
      name: wb.name,
      description: wb.description,
      createdAt: wb.created_at,
      updatedAt: wb.updated_at,
    }));

    const { data: itemData } = await this.supabase
      .from('wordbook_items')
      .select('*');
    const wordbookItems = (itemData ?? []).map((item: DbWordbookItem) => ({
      wordbookId: item.wordbook_id,
      wordId: item.word_id,
      addedAt: item.added_at,
    }));

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      words,
      studyProgress,
      wordbooks,
      wordbookItems,
    };
  }

  async importAll(data: ImportData): Promise<void> {
    const wordIdMap = new Map<string, string>();

    for (const word of data.words) {
      let created: Word;
      try {
        created = await this.words.create({
          term: word.term,
          reading: word.reading,
          meaning: word.meaning,
          notes: word.notes,
          tags: word.tags,
          jlptLevel: word.jlptLevel,
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'DUPLICATE_WORD') continue;
        throw err;
      }

      if (word.mastered) {
        await this.words.setMastered(created.id, true);
      }

      wordIdMap.set(word.id, created.id);

      const progress = data.studyProgress.find((p) => p.wordId === word.id);
      if (progress) {
        const { data: userData } = await this.supabase.auth.getUser();
        await this.supabase.from('study_progress').insert({
          user_id: userData.user!.id,
          word_id: created.id,
          next_review: progress.nextReview,
          interval_days: progress.intervalDays,
          ease_factor: progress.easeFactor,
          review_count: progress.reviewCount,
          last_reviewed_at: progress.lastReviewedAt,
        });
      }
    }

    if (data.version === 2) {
      const wordbookIdMap = new Map<string, string>();
      for (const wb of data.wordbooks) {
        const created = await this.wordbooks.create({
          name: wb.name,
          description: wb.description,
        });
        wordbookIdMap.set(wb.id, created.id);
      }

      for (const item of data.wordbookItems) {
        const wordbookId = wordbookIdMap.get(item.wordbookId);
        const wordId = wordIdMap.get(item.wordId);
        if (wordbookId && wordId) {
          try {
            await this.wordbooks.addWord(wordbookId, wordId);
          } catch {
            // Skip if word is mastered or already in wordbook
          }
        }
      }
    }
  }
}
