import type { SupabaseClient } from '@supabase/supabase-js';
import { reviewCard, createInitialProgress, isNewCard } from '@/lib/spaced-repetition';
import { getLocalDateString } from '@/lib/quiz/date-utils';
import { selectDueWords } from '@/lib/quiz/word-scoring';
import type {
  Word,
  CreateWordInput,
  UpdateWordInput,
  StudyProgress,
  WordWithProgress,
  ExportData,
  ImportData,
  UserWordStateExport,
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
  created_at: string;
  updated_at: string;
}

interface DbUserWordState {
  user_id: string;
  word_id: string;
  mastered: boolean;
  mastered_at: string | null;
  priority: number;
  is_leech: boolean;
  leech_at: string | null;
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

function dbWordToWord(row: DbWord, state?: DbUserWordState | null, currentUserId?: string): Word {
  return {
    id: row.id,
    term: row.term,
    reading: row.reading,
    meaning: row.meaning,
    notes: row.notes,
    tags: row.tags,
    jlptLevel: row.jlpt_level,
    priority: state?.priority ?? 2,
    mastered: state?.mastered ?? false,
    masteredAt: state?.mastered_at ? new Date(state.mastered_at) : null,
    isLeech: state?.is_leech ?? false,
    leechAt: state?.leech_at ? new Date(state.leech_at) : null,
    isOwned: currentUserId ? row.user_id === currentUserId : true,
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

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function toValidDate(value: Date | null, fallback: Date): Date {
  if (!value) return fallback;
  return isValidDate(value) ? value : fallback;
}

function toFiniteNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
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

/** Extract user_word_state from a nested select row */
function extractState(row: Record<string, unknown>): DbUserWordState | null {
  const arr = row.user_word_state as DbUserWordState[] | null;
  if (Array.isArray(arr) && arr.length > 0) return arr[0];
  return null;
}

class SupabaseWordRepository implements WordRepository {
  private _userIdCache = { userId: null as string | null };

  constructor(private supabase: SupabaseClient) {}

  private getUserId(): Promise<string> {
    return resolveUserId(this.supabase, this._userIdCache);
  }

  async getAll(): Promise<Word[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.supabase
      .from('words')
      .select('*, user_word_state(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const words = (data ?? []).map((row: Record<string, unknown>) => {
      const state = extractState(row);
      return dbWordToWord(row as unknown as DbWord, state, userId);
    });
    // Sort by priority asc, then created_at desc (already fetched desc)
    words.sort((a, b) => a.priority - b.priority);
    return words;
  }

  async getNonMastered(): Promise<Word[]> {
    const userId = await this.getUserId();
    const { data, error } = await this.supabase
      .from('words')
      .select('*, user_word_state(*)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const words = (data ?? [])
      .map((row: Record<string, unknown>) => {
        const state = extractState(row);
        return dbWordToWord(row as unknown as DbWord, state, userId);
      })
      .filter((w) => !w.mastered);
    words.sort((a, b) => a.priority - b.priority);
    return words;
  }

  async getNonMasteredPaginated(opts: {
    sort: import('./types').WordSortOrder;
    limit: number;
    offset: number;
  }): Promise<import('./types').PaginatedWords> {
    const userId = await this.getUserId();
    let query = this.supabase
      .from('v_words_active')
      .select('*', { count: 'exact' });

    // Server-side sorting
    if (opts.sort === 'newest') {
      query = query.order('created_at', { ascending: false });
    } else if (opts.sort === 'alphabetical') {
      query = query.order('term', { ascending: true });
    } else {
      // priority (default)
      query = query
        .order('priority', { ascending: true })
        .order('created_at', { ascending: false });
    }

    query = query.range(opts.offset, opts.offset + opts.limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    const words = (data ?? []).map((row: Record<string, unknown>) => {
      // v_words_active already has flattened priority/mastered columns
      const dbRow = row as unknown as DbWord & { priority: number; mastered: boolean; mastered_at: string | null; is_leech: boolean; leech_at: string | null };
      return {
        id: dbRow.id,
        term: dbRow.term,
        reading: dbRow.reading,
        meaning: dbRow.meaning,
        notes: dbRow.notes,
        tags: dbRow.tags,
        jlptLevel: dbRow.jlpt_level,
        priority: dbRow.priority ?? 2,
        mastered: dbRow.mastered ?? false,
        masteredAt: dbRow.mastered_at ? new Date(dbRow.mastered_at) : null,
        isLeech: dbRow.is_leech ?? false,
        leechAt: dbRow.leech_at ? new Date(dbRow.leech_at) : null,
        isOwned: dbRow.user_id === userId,
        createdAt: new Date(dbRow.created_at),
        updatedAt: new Date(dbRow.updated_at),
      } satisfies Word;
    });

    return { words, totalCount: count ?? 0 };
  }

  async getMastered(): Promise<Word[]> {
    const userId = await this.getUserId();
    // Query from user_word_state where mastered=true, joining words
    // This returns both owned + subscribed mastered words
    const { data, error } = await this.supabase
      .from('user_word_state')
      .select('*, words(*)')
      .eq('mastered', true)
      .order('mastered_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => {
      const state = row as unknown as DbUserWordState;
      const word = row.words as DbWord;
      return dbWordToWord(word, state, userId);
    });
  }

  async getMasteredPaginated(opts: {
    sort: import('./types').WordSortOrder;
    limit: number;
    offset: number;
  }): Promise<import('./types').PaginatedWords> {
    const userId = await this.getUserId();

    // Count total mastered
    const { count, error: countError } = await this.supabase
      .from('user_word_state')
      .select('*', { count: 'exact', head: true })
      .eq('mastered', true);
    if (countError) throw countError;

    let query = this.supabase
      .from('user_word_state')
      .select('*, words(*)')
      .eq('mastered', true);

    if (opts.sort === 'alphabetical') {
      query = query.order('term', { referencedTable: 'words', ascending: true });
    } else if (opts.sort === 'priority') {
      query = query.order('priority', { ascending: true })
        .order('mastered_at', { ascending: false });
    } else {
      // newest — sort by mastered_at desc
      query = query.order('mastered_at', { ascending: false });
    }

    query = query.range(opts.offset, opts.offset + opts.limit - 1);

    const { data, error } = await query;
    if (error) throw error;

    const words = (data ?? []).map((row: Record<string, unknown>) => {
      const state = row as unknown as DbUserWordState;
      const word = row.words as DbWord;
      return dbWordToWord(word, state, userId);
    });

    return { words, totalCount: count ?? 0 };
  }

  async getById(id: string): Promise<Word | null> {
    const userId = await this.getUserId();
    const { data, error } = await this.supabase
      .from('words')
      .select('*, user_word_state(*)')
      .eq('id', id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    const row = data as Record<string, unknown>;
    const state = extractState(row);
    return dbWordToWord(row as unknown as DbWord, state, userId);
  }

  async getByIds(ids: string[]): Promise<Word[]> {
    if (ids.length === 0) return [];
    const userId = await this.getUserId();
    const { data, error } = await this.supabase
      .from('words')
      .select('*, user_word_state(*)')
      .in('id', ids);
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => {
      const state = extractState(row);
      return dbWordToWord(row as unknown as DbWord, state, userId);
    });
  }

  async search(query: string): Promise<Word[]> {
    const userId = await this.getUserId();
    // Use v_words_active to exclude mastered words server-side
    const { data, error } = await this.supabase
      .from('v_words_active')
      .select('*')
      .or(`term.ilike.%${query}%,reading.ilike.%${query}%,meaning.ilike.%${query}%`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => {
      const dbRow = row as unknown as DbWord & { priority: number; mastered: boolean; mastered_at: string | null; is_leech: boolean; leech_at: string | null };
      return {
        id: dbRow.id,
        term: dbRow.term,
        reading: dbRow.reading,
        meaning: dbRow.meaning,
        notes: dbRow.notes,
        tags: dbRow.tags,
        jlptLevel: dbRow.jlpt_level,
        priority: dbRow.priority ?? 2,
        mastered: dbRow.mastered ?? false,
        masteredAt: dbRow.mastered_at ? new Date(dbRow.mastered_at) : null,
        isLeech: dbRow.is_leech ?? false,
        leechAt: dbRow.leech_at ? new Date(dbRow.leech_at) : null,
        isOwned: dbRow.user_id === userId,
        createdAt: new Date(dbRow.created_at),
        updatedAt: new Date(dbRow.updated_at),
      } satisfies Word;
    });
  }

  async create(input: CreateWordInput): Promise<Word> {
    const userId = await this.getUserId();

    // Insert word (without priority — that lives in user_word_state)
    const { data, error } = await this.supabase
      .from('words')
      .insert({
        user_id: userId,
        term: input.term,
        reading: input.reading,
        meaning: input.meaning,
        notes: input.notes ?? null,
        tags: input.tags ?? [],
        jlpt_level: input.jlptLevel ?? null,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('DUPLICATE_WORD');
      throw error;
    }
    const word = data as DbWord;

    // Insert user_word_state row for owned word
    const priority = input.priority ?? 2;
    const { error: stateError } = await this.supabase
      .from('user_word_state')
      .insert({
        user_id: userId,
        word_id: word.id,
        mastered: false,
        mastered_at: null,
        priority,
      });
    if (stateError) throw stateError;

    return dbWordToWord(word, { user_id: userId, word_id: word.id, mastered: false, mastered_at: null, priority, is_leech: false, leech_at: null }, userId);
  }

  async update(id: string, input: UpdateWordInput): Promise<Word> {
    const userId = await this.getUserId();
    const updatesWordContent =
      input.term !== undefined ||
      input.reading !== undefined ||
      input.meaning !== undefined ||
      input.notes !== undefined ||
      input.tags !== undefined ||
      input.jlptLevel !== undefined;

    // Priority-only updates must not PATCH words table.
    // Shared/subscribed words are not updatable in words, but user_word_state is.
    if (!updatesWordContent && input.priority !== undefined) {
      const { error: stateError } = await this.supabase
        .from('user_word_state')
        .upsert(
          {
            user_id: userId,
            word_id: id,
            priority: input.priority,
          },
          { onConflict: 'user_id,word_id' },
        );
      if (stateError) throw stateError;

      const { data: refreshed, error: refreshError } = await this.supabase
        .from('words')
        .select('*, user_word_state(*)')
        .eq('id', id)
        .single();
      if (refreshError) throw refreshError;

      const row = refreshed as Record<string, unknown>;
      return dbWordToWord(row as unknown as DbWord, extractState(row), userId);
    }

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
      .select('*, user_word_state(*)')
      .single();
    if (error) {
      if (error.code === '23505') throw new Error('DUPLICATE_WORD');
      throw error;
    }

    // Update priority in user_word_state if provided
    if (input.priority !== undefined) {
      await this.supabase
        .from('user_word_state')
        .upsert(
          {
            user_id: userId,
            word_id: id,
            priority: input.priority,
          },
          { onConflict: 'user_id,word_id' },
        );
    }

    const row = data as Record<string, unknown>;
    let state = extractState(row);
    if (input.priority !== undefined && state) {
      state = { ...state, priority: input.priority };
    }
    return dbWordToWord(row as unknown as DbWord, state, userId);
  }

  async setPriority(id: string, priority: number): Promise<void> {
    const userId = await this.getUserId();

    const { error } = await this.supabase
      .from('user_word_state')
      .upsert(
        {
          user_id: userId,
          word_id: id,
          priority,
        },
        { onConflict: 'user_id,word_id' },
      );
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.from('words').delete().eq('id', id);
    if (error) throw error;
  }

  async setMastered(id: string, mastered: boolean): Promise<Word> {
    const userId = await this.getUserId();
    const now = new Date().toISOString();

    // Upsert into user_word_state (works for owned + subscribed)
    const { error: stateError } = await this.supabase
      .from('user_word_state')
      .upsert({
        user_id: userId,
        word_id: id,
        mastered,
        mastered_at: mastered ? now : null,
      }, { onConflict: 'user_id,word_id' });
    if (stateError) throw stateError;

    if (mastered) {
      await this.supabase
        .from('wordbook_items')
        .delete()
        .eq('word_id', id);
    }

    // Re-fetch word with state
    const { data, error } = await this.supabase
      .from('words')
      .select('*, user_word_state(*)')
      .eq('id', id)
      .single();
    if (error) throw error;
    const row = data as Record<string, unknown>;
    return dbWordToWord(row as unknown as DbWord, extractState(row), userId);
  }
}

/** Cached userId helper shared across repositories */
async function resolveUserId(supabase: SupabaseClient, cache: { userId: string | null }): Promise<string> {
  if (!cache.userId) {
    const { data } = await supabase.auth.getUser();
    cache.userId = data.user!.id;
  }
  return cache.userId;
}

class SupabaseStudyRepository implements StudyRepository {
  private _cache = new Map<string, { data: unknown; expiry: number }>();
  private _inflight = new Map<string, Promise<unknown>>();
  private _userIdCache = { userId: null as string | null };

  constructor(private supabase: SupabaseClient) {}

  private getUserId(): Promise<string> {
    return resolveUserId(this.supabase, this._userIdCache);
  }

  /** Dedup concurrent calls + short-lived cache */
  private async cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this._cache.get(key);
    if (hit && hit.expiry > Date.now()) return hit.data as T;

    const pending = this._inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = fn().then((data) => {
      this._cache.set(key, { data, expiry: Date.now() + ttlMs });
      this._inflight.delete(key);
      return data;
    }).catch((e) => {
      this._inflight.delete(key);
      throw e;
    });
    this._inflight.set(key, promise);
    return promise;
  }

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

  async getProgressByIds(wordIds: string[]): Promise<Map<string, StudyProgress>> {
    const map = new Map<string, StudyProgress>();
    if (wordIds.length === 0) return map;
    const { data, error } = await this.supabase
      .from('study_progress')
      .select('*')
      .in('word_id', wordIds);
    if (error) throw error;
    for (const row of data ?? []) {
      const progress = dbProgressToProgress(row as DbStudyProgress);
      map.set(progress.wordId, progress);
    }
    return map;
  }

  async getDueCount(): Promise<number> {
    return this.cached('due_count', 5_000, () => this._getDueCountImpl());
  }

  private async _getDueCountImpl(): Promise<number> {
    const now = new Date().toISOString();
    const settings = await this.getQuizSettings();
    const todayStats = await this.getDailyStats(getLocalDateString());

    // Review-due: have progress, past due, not mastered
    const { data: dueData, error: e1 } = await this.supabase
      .from('study_progress')
      .select('word_id, words!inner(id, user_word_state(mastered))')
      .lte('next_review', now);
    if (e1) throw e1;
    const reviewDue = (dueData ?? []).filter((row: Record<string, unknown>) => {
      const word = row.words as Record<string, unknown>;
      const states = word.user_word_state as Array<{ mastered: boolean }> | null;
      return !states?.[0]?.mastered;
    }).length;

    // New words: no progress, not mastered
    const { data: newData, error: e2 } = await this.supabase
      .from('words')
      .select('id, study_progress(id), user_word_state(mastered)');
    if (e2) throw e2;
    const totalNew = (newData ?? []).filter((row: Record<string, unknown>) => {
      const sp = row.study_progress as Array<{ id: string }> | null;
      const states = row.user_word_state as Array<{ mastered: boolean }> | null;
      return (!sp || sp.length === 0) && !states?.[0]?.mastered;
    }).length;

    const remainingNew = Math.max(0, settings.newPerDay - (todayStats?.newCount ?? 0));
    const cappedNew = Math.min(totalNew, remainingNew);
    const totalDue = reviewDue + cappedNew;
    const remainingReviews = Math.max(0, settings.maxReviewsPerDay - (todayStats?.reviewCount ?? 0));

    return Math.min(totalDue, remainingReviews);
  }

  async getDueWords(limit = 20): Promise<WordWithProgress[]> {
    const now = new Date().toISOString();
    const settings = await this.getQuizSettings();
    const todayStats = await this.getDailyStats(getLocalDateString());

    // Fetch review-due words (have progress, past due)
    const { data: dueProgress, error: progressError } = await this.supabase
      .from('study_progress')
      .select('*, words(*, user_word_state(*))')
      .lte('next_review', now);
    if (progressError) throw progressError;

    const currentUserId = await this.getUserId();
    const reviewWords: WordWithProgress[] = (dueProgress ?? [])
      .filter((row) => {
        const word = (row as Record<string, unknown>).words as Record<string, unknown>;
        const state = extractState(word);
        return !state?.mastered;
      })
      .map((row) => {
        const wordRow = (row as Record<string, unknown>).words as Record<string, unknown>;
        const state = extractState(wordRow);
        return {
          ...dbWordToWord(wordRow as unknown as DbWord, state, currentUserId),
          progress: dbProgressToProgress(row as unknown as DbStudyProgress),
        };
      });

    // Fetch new words (no progress), cap at remainingNew
    const remainingNew = Math.max(0, settings.newPerDay - (todayStats?.newCount ?? 0));

    let newWordsQuery = this.supabase
      .from('words')
      .select('*, study_progress(id), user_word_state(*)')
      .is('study_progress', null);

    if (settings.jlptFilter !== null) {
      newWordsQuery = newWordsQuery.eq('jlpt_level', settings.jlptFilter);
    }

    const { data: newWordsData, error: wordsError } = await newWordsQuery.limit(remainingNew * 3);
    if (wordsError) throw wordsError;

    const newWords: WordWithProgress[] = (newWordsData ?? [])
      .filter((row: Record<string, unknown>) => {
        const state = extractState(row);
        if (state?.mastered) return false;
        if (settings.priorityFilter !== null && (state?.priority ?? 2) !== settings.priorityFilter) return false;
        return true;
      })
      .slice(0, remainingNew)
      .map((row: Record<string, unknown>) => {
        const state = extractState(row);
        return {
          ...dbWordToWord(row as unknown as DbWord, state, currentUserId),
          progress: null,
        };
      });

    const candidates = [...reviewWords, ...newWords];
    const remainingReviews = Math.max(0, settings.maxReviewsPerDay - (todayStats?.reviewCount ?? 0));
    const effectiveLimit = Math.min(limit, remainingReviews);

    return selectDueWords(candidates, effectiveLimit, settings.jlptFilter);
  }

  async recordReview(wordId: string, quality: number): Promise<void> {
    const existing = await this.getProgress(wordId);
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const wasNew = isNewCard(existing);
    const now = new Date();

    const baseProgress = existing
      ? {
          ...existing,
          nextReview: toValidDate(existing.nextReview, now),
          lastReviewedAt: existing.lastReviewedAt ? toValidDate(existing.lastReviewedAt, now) : null,
          intervalDays: toFiniteNumber(existing.intervalDays, 0),
          easeFactor: toFiniteNumber(existing.easeFactor, 2.5),
          reviewCount: toFiniteNumber(existing.reviewCount, 0),
          stability: toFiniteNumber(existing.stability, 0),
          difficulty: toFiniteNumber(existing.difficulty, 0),
          elapsedDays: toFiniteNumber(existing.elapsedDays, 0),
          scheduledDays: toFiniteNumber(existing.scheduledDays, 0),
          learningSteps: toFiniteNumber(existing.learningSteps, 0),
          lapses: toFiniteNumber(existing.lapses, 0),
          cardState: toFiniteNumber(existing.cardState, 0),
        }
      : createInitialProgress(wordId);

    const reviewed = reviewCard(quality, baseProgress);
    const updated = {
      ...reviewed,
      nextReview: toValidDate(reviewed.nextReview, now),
      lastReviewedAt: reviewed.lastReviewedAt ? toValidDate(reviewed.lastReviewedAt, now) : now,
      intervalDays: toFiniteNumber(reviewed.intervalDays, 0),
      easeFactor: toFiniteNumber(reviewed.easeFactor, 2.5),
      reviewCount: toFiniteNumber(reviewed.reviewCount, 0),
      stability: toFiniteNumber(reviewed.stability, 0),
      difficulty: toFiniteNumber(reviewed.difficulty, 0),
      elapsedDays: toFiniteNumber(reviewed.elapsedDays, 0),
      scheduledDays: toFiniteNumber(reviewed.scheduledDays, 0),
      learningSteps: toFiniteNumber(reviewed.learningSteps, 0),
      lapses: toFiniteNumber(reviewed.lapses, 0),
      cardState: toFiniteNumber(reviewed.cardState, 0),
    };

    if (existing) {
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
    await this.incrementDailyStats(today, wasNew, quality);

    // Upgrade priority to high when rated "Again" — now in user_word_state
    if (quality === 0) {
      await this.supabase
        .from('user_word_state')
        .update({ priority: 1 })
        .eq('user_id', userId)
        .eq('word_id', wordId)
        .gt('priority', 1);
      // Check leech threshold
      await this.checkAndMarkLeech(wordId);
    }
    this._cache.delete('due_count');
  }

  async getQuizSettings(): Promise<QuizSettings> {
    return this.cached('quiz_settings', 30_000, async () => {
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
        cardDirection: data.card_direction ?? 'term_first',
        sessionSize: data.session_size ?? 20,
        leechThreshold: data.leech_threshold ?? 8,
      };
    });
  }

  async updateQuizSettings(settings: Partial<QuizSettings>): Promise<void> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (settings.newPerDay !== undefined) updateData.new_per_day = settings.newPerDay;
    if (settings.maxReviewsPerDay !== undefined) updateData.max_reviews_per_day = settings.maxReviewsPerDay;
    if (settings.jlptFilter !== undefined) updateData.jlpt_filter = settings.jlptFilter;
    if (settings.priorityFilter !== undefined) updateData.priority_filter = settings.priorityFilter;
    if (settings.cardDirection !== undefined) updateData.card_direction = settings.cardDirection;
    if (settings.sessionSize !== undefined) updateData.session_size = settings.sessionSize;
    if (settings.leechThreshold !== undefined) updateData.leech_threshold = settings.leechThreshold;

    const { error } = await this.supabase
      .from('quiz_settings')
      .upsert({ user_id: userId, ...updateData }, { onConflict: 'user_id' });
    if (error) throw error;
    this._cache.delete('quiz_settings');
  }

  async getDailyStats(date: string): Promise<DailyStats | null> {
    return this.cached(`daily_stats:${date}`, 10_000, async () => {
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
        reviewAgainCount: data.review_again_count ?? 0,
        newAgainCount: data.new_again_count ?? 0,
        hardCount: data.hard_count ?? 0,
        goodCount: data.good_count ?? 0,
        easyCount: data.easy_count ?? 0,
        masteredInSessionCount: data.mastered_in_session_count ?? 0,
        practiceCount: data.practice_count ?? 0,
        practiceKnownCount: data.practice_known_count ?? 0,
      };
    });
  }

  async incrementDailyStats(date: string, isNew: boolean, quality: number): Promise<void> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const isAgain = quality === 0;
    const existing = await this.getDailyStats(date);
    if (existing) {
      const { error } = await this.supabase
        .from('daily_stats')
        .update({
          new_count: existing.newCount + (isNew ? 1 : 0),
          review_count: existing.reviewCount + 1,
          again_count: existing.againCount + (isAgain ? 1 : 0),
          review_again_count: existing.reviewAgainCount + (!isNew && isAgain ? 1 : 0),
          new_again_count: existing.newAgainCount + (isNew && isAgain ? 1 : 0),
          hard_count: existing.hardCount + (quality === 1 ? 1 : 0),
          good_count: existing.goodCount + (quality === 2 ? 1 : 0),
          easy_count: existing.easyCount + (quality === 3 ? 1 : 0),
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
          review_again_count: !isNew && isAgain ? 1 : 0,
          new_again_count: isNew && isAgain ? 1 : 0,
          hard_count: quality === 1 ? 1 : 0,
          good_count: quality === 2 ? 1 : 0,
          easy_count: quality === 3 ? 1 : 0,
        });
      if (error) throw error;
    }
    this._cache.delete(`daily_stats:${date}`);
  }

  async incrementMasteredStats(date: string): Promise<void> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const existing = await this.getDailyStats(date);
    if (existing) {
      const { error } = await this.supabase
        .from('daily_stats')
        .update({
          mastered_in_session_count: existing.masteredInSessionCount + 1,
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await this.supabase
        .from('daily_stats')
        .insert({
          user_id: userId,
          stat_date: date,
          mastered_in_session_count: 1,
        });
      if (error) throw error;
    }
    this._cache.delete(`daily_stats:${date}`);
  }

  async incrementPracticeStats(date: string, known: boolean): Promise<void> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const existing = await this.getDailyStats(date);
    if (existing) {
      const { error } = await this.supabase
        .from('daily_stats')
        .update({
          practice_count: existing.practiceCount + 1,
          practice_known_count: existing.practiceKnownCount + (known ? 1 : 0),
        })
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await this.supabase
        .from('daily_stats')
        .insert({
          user_id: userId,
          stat_date: date,
          practice_count: 1,
          practice_known_count: known ? 1 : 0,
        });
      if (error) throw error;
    }
    this._cache.delete(`daily_stats:${date}`);
  }

  async checkAndMarkLeech(wordId: string): Promise<boolean> {
    const settings = await this.getQuizSettings();
    const progress = await this.getProgress(wordId);
    if (!progress || progress.lapses < settings.leechThreshold) return false;

    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    const { error } = await this.supabase
      .from('user_word_state')
      .update({ is_leech: true, leech_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('word_id', wordId)
      .eq('is_leech', false);
    if (error) throw error;
    return true;
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

  async getDailyStatsRange(startDate: string, endDate: string): Promise<DailyStats[]> {
    const { data, error } = await this.supabase
      .from('daily_stats')
      .select('*')
      .gte('stat_date', startDate)
      .lte('stat_date', endDate)
      .order('stat_date', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((d: Record<string, unknown>) => ({
      id: d.id as string,
      date: d.stat_date as string,
      newCount: (d.new_count as number) ?? 0,
      reviewCount: (d.review_count as number) ?? 0,
      againCount: (d.again_count as number) ?? 0,
      reviewAgainCount: (d.review_again_count as number) ?? 0,
      newAgainCount: (d.new_again_count as number) ?? 0,
      hardCount: (d.hard_count as number) ?? 0,
      goodCount: (d.good_count as number) ?? 0,
      easyCount: (d.easy_count as number) ?? 0,
      masteredInSessionCount: (d.mastered_in_session_count as number) ?? 0,
      practiceCount: (d.practice_count as number) ?? 0,
      practiceKnownCount: (d.practice_known_count as number) ?? 0,
    }));
  }

  async getCardStateDistribution(): Promise<{ state: number; count: number }[]> {
    const { data, error } = await this.supabase
      .from('study_progress')
      .select('card_state');
    if (error) throw error;
    const counts = new Map<number, number>();
    for (const row of data ?? []) {
      const state = (row as { card_state: number }).card_state ?? 0;
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([state, count]) => ({ state, count }));
  }

  async getTotalReviewedAllTime(): Promise<number> {
    const { data, error } = await this.supabase
      .from('daily_stats')
      .select('review_count');
    if (error) throw error;
    let total = 0;
    for (const row of data ?? []) {
      total += (row as { review_count: number }).review_count ?? 0;
    }
    return total;
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
  private _userIdCache = { userId: null as string | null };

  constructor(private supabase: SupabaseClient) {}

  private getUserId(): Promise<string> {
    return resolveUserId(this.supabase, this._userIdCache);
  }

  async getAll(): Promise<WordbookWithCount[]> {
    const userId = await this.getUserId();

    const { data, error } = await this.supabase
      .from('wordbooks')
      .select('*, wordbook_items(count)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = (data ?? []) as unknown as Array<DbWordbook & { wordbook_items: [{ count: number }] }>;
    const wbIds = rows.filter((wb) => (wb.wordbook_items[0]?.count ?? 0) > 0).map((wb) => wb.id);

    // Single batch RPC instead of N sequential calls
    const masteredMap = new Map<string, number>();
    if (wbIds.length > 0) {
      const { data: rpcData } = await this.supabase
        .rpc('get_wordbook_mastered_counts', { wb_ids: wbIds });
      for (const row of (rpcData ?? []) as Array<{ wordbook_id: string; mastered_count: number }>) {
        masteredMap.set(row.wordbook_id, row.mastered_count);
      }
    }

    return rows.map((wb) => ({
      ...dbWordbookToWordbook(wb),
      wordCount: wb.wordbook_items[0]?.count ?? 0,
      importCount: wb.import_count ?? 0,
      masteredCount: masteredMap.get(wb.id) ?? 0,
    }));
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
    const userId = await this.getUserId();
    const PAGE_SIZE = 1000;
    const allWords: Word[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await this.supabase
        .from('wordbook_items')
        .select('word_id, words(*, user_word_state(*))')
        .eq('wordbook_id', wordbookId)
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data ?? []).map((row) => {
        const wordRow = (row as Record<string, unknown>).words as Record<string, unknown>;
        const state = extractState(wordRow);
        return dbWordToWord(wordRow as unknown as DbWord, state, userId);
      });
      allWords.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return allWords;
  }

  async getWordsPaginated(
    wordbookId: string,
    opts: { sort: import('./types').WordSortOrder; limit: number; offset: number },
  ): Promise<import('./types').PaginatedWords> {
    const userId = await this.getUserId();
    let query = this.supabase
      .from('wordbook_items')
      .select('word_id, words(*, user_word_state(*))', { count: 'exact' })
      .eq('wordbook_id', wordbookId);

    if (opts.sort === 'alphabetical') {
      query = query.order('term', { ascending: true, foreignTable: 'words' });
    } else {
      query = query.order('created_at', { ascending: false, foreignTable: 'words' });
    }

    const { data, count, error } = await query.range(opts.offset, opts.offset + opts.limit - 1);
    if (error) throw error;
    const words = (data ?? []).map((row) => {
      const wordRow = (row as Record<string, unknown>).words as Record<string, unknown>;
      const state = extractState(wordRow);
      return dbWordToWord(wordRow as unknown as DbWord, state, userId);
    });
    return { words, totalCount: count ?? 0 };
  }

  async addWord(wordbookId: string, wordId: string): Promise<void> {
    const { data: userData } = await this.supabase.auth.getUser();
    const userId = userData.user!.id;

    // Ensure destination wordbook is owned by current user.
    const { data: targetWordbook, error: targetWordbookError } = await this.supabase
      .from('wordbooks')
      .select('id, user_id')
      .eq('id', wordbookId)
      .single();
    if (targetWordbookError) throw targetWordbookError;
    if ((targetWordbook as { user_id: string }).user_id !== userId) {
      throw new Error('Cannot add words to non-owned wordbook');
    }

    // Resolve source word. For subscribed/shared words, create or reuse
    // an owned copy so the added item remains stable after unsubscribe.
    const { data: sourceWord, error: sourceWordError } = await this.supabase
      .from('words')
      .select('id, user_id, term, reading, meaning, notes, tags, jlpt_level')
      .eq('id', wordId)
      .single();
    if (sourceWordError) throw sourceWordError;

    const source = sourceWord as DbWord;
    let effectiveWordId = wordId;
    if (source.user_id !== userId) {
      const { data: existingOwned, error: existingOwnedError } = await this.supabase
        .from('words')
        .select('id')
        .eq('user_id', userId)
        .eq('term', source.term)
        .eq('reading', source.reading)
        .maybeSingle();
      if (existingOwnedError) throw existingOwnedError;

      if (existingOwned) {
        effectiveWordId = (existingOwned as { id: string }).id;
      } else {
        const { data: createdOwned, error: createdOwnedError } = await this.supabase
          .from('words')
          .insert({
            user_id: userId,
            term: source.term,
            reading: source.reading,
            meaning: source.meaning,
            notes: source.notes,
            tags: source.tags,
            jlpt_level: source.jlpt_level,
          })
          .select('id')
          .single();
        if (createdOwnedError) throw createdOwnedError;
        effectiveWordId = (createdOwned as { id: string }).id;
      }
    }

    // Ensure current user has user_word_state row for the effective word.
    const { error: stateUpsertError } = await this.supabase
      .from('user_word_state')
      .upsert(
        {
          user_id: userId,
          word_id: effectiveWordId,
        },
        { onConflict: 'user_id,word_id' },
      );
    if (stateUpsertError) throw stateUpsertError;

    // Check mastered status scoped to current user only.
    const { data: stateData, error: stateError } = await this.supabase
      .from('user_word_state')
      .select('mastered')
      .eq('user_id', userId)
      .eq('word_id', effectiveWordId)
      .maybeSingle();
    if (stateError) throw stateError;
    if ((stateData as { mastered: boolean } | null)?.mastered) {
      throw new Error('Cannot add mastered word to wordbook');
    }

    const { error } = await this.supabase
      .from('wordbook_items')
      .insert({ wordbook_id: wordbookId, word_id: effectiveWordId });
    if (error) {
      if (error.code === '23505') return;
      throw error;
    }
  }

  async addWords(wordbookId: string, wordIds: string[]): Promise<void> {
    if (wordIds.length === 0) return;
    const userId = await this.getUserId();

    // Verify ownership of target wordbook once
    const { data: targetWordbook, error: targetWordbookError } = await this.supabase
      .from('wordbooks')
      .select('id, user_id')
      .eq('id', wordbookId)
      .single();
    if (targetWordbookError) throw targetWordbookError;
    if ((targetWordbook as { user_id: string }).user_id !== userId) {
      throw new Error('Cannot add words to non-owned wordbook');
    }

    // Fetch all source words in one query
    const { data: sourceWords, error: sourceError } = await this.supabase
      .from('words')
      .select('id, user_id, term, reading, meaning, notes, tags, jlpt_level')
      .in('id', wordIds);
    if (sourceError) throw sourceError;

    const ownedWordIds: string[] = [];
    const nonOwnedWords = new Map<string, DbWord>();
    for (const w of (sourceWords ?? []) as DbWord[]) {
      if (w.user_id === userId) {
        ownedWordIds.push(w.id);
      } else {
        nonOwnedWords.set(w.id, w);
      }
    }

    // Batch-insert owned words directly
    if (ownedWordIds.length > 0) {
      // Ensure user_word_state exists for all owned words
      await this.supabase
        .from('user_word_state')
        .upsert(
          ownedWordIds.map((wid) => ({ user_id: userId, word_id: wid })),
          { onConflict: 'user_id,word_id' },
        );

      // Filter out mastered words
      const { data: masteredStates } = await this.supabase
        .from('user_word_state')
        .select('word_id')
        .eq('user_id', userId)
        .in('word_id', ownedWordIds)
        .eq('mastered', true);
      const masteredIds = new Set((masteredStates ?? []).map((s) => (s as { word_id: string }).word_id));
      const insertIds = ownedWordIds.filter((id) => !masteredIds.has(id));

      if (insertIds.length > 0) {
        const { error: insertError } = await this.supabase
          .from('wordbook_items')
          .upsert(
            insertIds.map((wid) => ({ wordbook_id: wordbookId, word_id: wid })),
            { onConflict: 'wordbook_id,word_id' },
          );
        if (insertError) throw insertError;
      }
    }

    // Handle non-owned words individually (need copy logic)
    for (const [wordId] of nonOwnedWords) {
      await this.addWord(wordbookId, wordId);
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
    const userId = await this.getUserId();

    const { data, error } = await this.supabase
      .from('wordbook_subscriptions')
      .select('wordbook_id, wordbooks(*, wordbook_items(count))')
      .eq('subscriber_id', userId);
    if (error) throw error;

    const rows = (data ?? []).map((row) =>
      (row as Record<string, unknown>).wordbooks as unknown as DbWordbook & { wordbook_items: [{ count: number }] },
    );
    const wbIds = rows.filter((wb) => (wb.wordbook_items[0]?.count ?? 0) > 0).map((wb) => wb.id);

    // Single batch RPC instead of N sequential calls
    const masteredMap = new Map<string, number>();
    if (wbIds.length > 0) {
      const { data: rpcData } = await this.supabase
        .rpc('get_wordbook_mastered_counts', { wb_ids: wbIds });
      for (const row of (rpcData ?? []) as Array<{ wordbook_id: string; mastered_count: number }>) {
        masteredMap.set(row.wordbook_id, row.mastered_count);
      }
    }

    return rows.map((wb) => ({
      ...dbWordbookToWordbook(wb),
      wordCount: wb.wordbook_items[0]?.count ?? 0,
      importCount: wb.import_count ?? 0,
      masteredCount: masteredMap.get(wb.id) ?? 0,
    }));
  }

  async browseShared(): Promise<SharedWordbookListItem[]> {
    const userId = await this.getUserId();

    const { data, error } = await this.supabase
      .from('wordbooks')
      .select('*, wordbook_items(count), wordbook_subscriptions(subscriber_id)')
      .eq('is_shared', true)
      .neq('user_id', userId)
      .order('is_system', { ascending: false })
      .order('import_count', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;

    type BrowseRow = DbWordbook & {
      wordbook_items: [{ count: number }];
      wordbook_subscriptions: Array<{ subscriber_id: string }>;
    };
    const rows = (data ?? []) as unknown as BrowseRow[];

    // Single batch RPC for all owner emails instead of N sequential calls
    const uniqueOwnerIds = [...new Set(rows.map((wb) => wb.user_id))];
    const emailMap = new Map<string, string>();
    if (uniqueOwnerIds.length > 0) {
      const { data: emailData } = await this.supabase
        .rpc('get_user_emails', { uids: uniqueOwnerIds });
      for (const row of (emailData ?? []) as Array<{ uid: string; email: string }>) {
        emailMap.set(row.uid, row.email);
      }
    }

    return rows.map((wb) => ({
      ...dbWordbookToWordbook(wb),
      wordCount: wb.wordbook_items[0]?.count ?? 0,
      importCount: wb.import_count ?? 0,
      masteredCount: 0,
      ownerEmail: emailMap.get(wb.user_id) ?? '',
      isSubscribed: wb.wordbook_subscriptions.some((s) => s.subscriber_id === userId),
    }));
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
    await this.supabase.rpc('increment_import_count', { wb_id: wordbookId });
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

        // Create user_word_state for the newly copied word
        await this.supabase
          .from('user_word_state')
          .insert({
            user_id: userId,
            word_id: wordId,
            mastered: false,
            priority: 2,
          });
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

    // Export user_word_state
    const { data: uwsData } = await this.supabase
      .from('user_word_state')
      .select('*')
      .eq('user_id', userId);
    const userWordState: UserWordStateExport[] = (uwsData ?? []).map((row: DbUserWordState) => ({
      wordId: row.word_id,
      mastered: row.mastered,
      masteredAt: row.mastered_at,
      priority: row.priority,
    }));

    return {
      version: 3,
      exportedAt: new Date().toISOString(),
      words,
      studyProgress,
      wordbooks,
      wordbookItems,
      userWordState,
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

      wordIdMap.set(word.id, created.id);

      // Handle mastered state
      if (data.version === 3) {
        // v3: mastered info is in userWordState array — handled below
      } else {
        // v1/v2: mastered info is on the word object
        if (word.mastered) {
          await this.words.setMastered(created.id, true);
        }
      }

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

    // Import user_word_state for v3
    if (data.version === 3 && data.userWordState) {
      const { data: userData } = await this.supabase.auth.getUser();
      const userId = userData.user!.id;

      for (const uws of data.userWordState) {
        const newWordId = wordIdMap.get(uws.wordId);
        if (!newWordId) continue;
        await this.supabase
          .from('user_word_state')
          .upsert({
            user_id: userId,
            word_id: newWordId,
            mastered: uws.mastered,
            mastered_at: uws.masteredAt,
            priority: uws.priority,
          }, { onConflict: 'user_id,word_id' });
      }
    }

    if (data.version === 2 || data.version === 3) {
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
