import type { SupabaseClient } from '@supabase/supabase-js';
import { sm2, createInitialProgress } from '@/lib/spaced-repetition';
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
}

interface DbWordbook {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_shared: boolean;
  is_system: boolean;
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
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data as DbWord[]).map(dbWordToWord);
  }

  async getNonMastered(): Promise<Word[]> {
    const { data, error } = await this.supabase
      .from('words')
      .select('*')
      .eq('mastered', false)
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
      })
      .select()
      .single();
    if (error) throw error;
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

    const { data, error } = await this.supabase
      .from('words')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
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

    if (existing) {
      const updated = sm2(quality, existing);
      const { error } = await this.supabase
        .from('study_progress')
        .update({
          next_review: updated.nextReview.toISOString(),
          interval_days: updated.intervalDays,
          ease_factor: updated.easeFactor,
          review_count: updated.reviewCount,
          last_reviewed_at: updated.lastReviewedAt?.toISOString() ?? null,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const initial = createInitialProgress(wordId);
      const updated = sm2(quality, initial);
      const { error } = await this.supabase.from('study_progress').insert({
        user_id: userId,
        word_id: wordId,
        next_review: updated.nextReview.toISOString(),
        interval_days: updated.intervalDays,
        ease_factor: updated.easeFactor,
        review_count: updated.reviewCount,
        last_reviewed_at: updated.lastReviewedAt?.toISOString() ?? null,
      });
      if (error) throw error;
    }
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

    return (data ?? []).map((row) => {
      const wb = row as unknown as DbWordbook & {
        wordbook_items: [{ count: number }];
      };
      return {
        ...dbWordbookToWordbook(wb),
        wordCount: wb.wordbook_items[0]?.count ?? 0,
      };
    });
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
      })
      .select()
      .single();
    if (error) throw error;
    return dbWordbookToWordbook(data as DbWordbook);
  }

  async update(id: string, input: UpdateWordbookInput): Promise<Wordbook> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.isShared !== undefined) updateData.is_shared = input.isShared;

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
      if (error.code === '23505') return; // unique constraint — already exists
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
      if (error.code === '23505') return; // already subscribed
      throw error;
    }
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

    // Fetch the source wordbook
    const source = await this.getById(wordbookId);
    if (!source) throw new Error('Wordbook not found');

    // Fetch the source words
    const sourceWords = await this.getWords(wordbookId);

    // Create the new wordbook
    const newWb = await this.create({
      name: source.name,
      description: source.description,
    });

    // Get existing user words to dedup by (term, reading)
    const { data: existingWords } = await this.supabase
      .from('words')
      .select('id, term, reading')
      .eq('user_id', userId);

    const existingMap = new Map(
      (existingWords ?? []).map((w: { id: string; term: string; reading: string }) =>
        [`${w.term}|${w.reading}`, w.id],
      ),
    );

    // Copy words and link to new wordbook
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
      const created = await this.words.create({
        term: word.term,
        reading: word.reading,
        meaning: word.meaning,
        notes: word.notes,
        tags: word.tags,
        jlptLevel: word.jlptLevel,
      });

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
