import {
  db,
  type LocalWord,
  type LocalUserWordState,
  type LocalStudyProgress,
  type LocalWordbook,
  type LocalDailyStats,
  type LocalQuizSettings,
  type LocalAchievement,
} from '@/lib/db/dexie';
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

function localWordToWord(local: LocalWord & { id: number }, state?: LocalUserWordState | null): Word {
  return {
    id: String(local.id),
    term: local.term,
    reading: local.reading,
    meaning: local.meaning,
    notes: local.notes,
    tags: local.tags,
    jlptLevel: local.jlptLevel,
    priority: state?.priority ?? 2,
    mastered: state?.mastered ?? false,
    masteredAt: state?.masteredAt ?? null,
    isLeech: state?.isLeech ?? false,
    leechAt: state?.leechAt ?? null,
    isOwned: true, // IndexedDB = guest mode, all words are owned
    createdAt: local.createdAt,
    updatedAt: local.updatedAt,
  };
}

function localProgressToProgress(
  local: LocalStudyProgress & { id: number },
): StudyProgress {
  return {
    id: String(local.id),
    wordId: String(local.wordId),
    nextReview: local.nextReview,
    intervalDays: local.intervalDays,
    easeFactor: local.easeFactor,
    reviewCount: local.reviewCount,
    lastReviewedAt: local.lastReviewedAt,
    stability: local.stability ?? 0,
    difficulty: local.difficulty ?? 0,
    elapsedDays: local.elapsedDays ?? 0,
    scheduledDays: local.scheduledDays ?? 0,
    learningSteps: local.learningSteps ?? 0,
    lapses: local.lapses ?? 0,
    cardState: local.cardState ?? 0,
  };
}

function localWordbookToWordbook(local: LocalWordbook & { id: number }): Wordbook {
  return {
    id: String(local.id),
    userId: '',
    name: local.name,
    description: local.description,
    isShared: false,
    isSystem: false,
    tags: [],
    createdAt: local.createdAt,
    updatedAt: local.updatedAt,
  };
}

/** Get user_word_state for a given word ID */
async function getState(wordId: number): Promise<(LocalUserWordState & { id: number }) | null> {
  const state = await db.userWordState.where('wordId').equals(wordId).first();
  return state ? (state as LocalUserWordState & { id: number }) : null;
}

/** Batch-load all user_word_state into a Map keyed by wordId */
async function getAllStates(): Promise<Map<number, LocalUserWordState & { id: number }>> {
  const states = await db.userWordState.toArray();
  const map = new Map<number, LocalUserWordState & { id: number }>();
  for (const s of states) {
    map.set(s.wordId, s as LocalUserWordState & { id: number });
  }
  return map;
}

class IndexedDBWordRepository implements WordRepository {
  async getAll(): Promise<Word[]> {
    const [words, stateMap] = await Promise.all([db.words.toArray(), getAllStates()]);
    const result = words.map((w) => {
      const typed = w as LocalWord & { id: number };
      return localWordToWord(typed, stateMap.get(typed.id) ?? null);
    });
    result.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    return result;
  }

  async getNonMastered(): Promise<Word[]> {
    const [words, stateMap] = await Promise.all([db.words.toArray(), getAllStates()]);
    const result: Word[] = [];
    for (const w of words) {
      const typed = w as LocalWord & { id: number };
      const state = stateMap.get(typed.id) ?? null;
      if (state?.mastered) continue;
      result.push(localWordToWord(typed, state));
    }
    result.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    return result;
  }

  async getNonMasteredPaginated(opts: {
    sort: import('./types').WordSortOrder;
    limit: number;
    offset: number;
  }): Promise<import('./types').PaginatedWords> {
    // IndexedDB: load all non-mastered, sort, then slice
    const all = await this.getNonMastered();
    // Re-sort based on requested order
    if (opts.sort === 'newest') {
      all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } else if (opts.sort === 'alphabetical') {
      all.sort((a, b) => a.term.localeCompare(b.term, 'ja'));
    }
    // 'priority' is already default sort from getNonMastered
    return {
      words: all.slice(opts.offset, opts.offset + opts.limit),
      totalCount: all.length,
    };
  }

  async getMastered(): Promise<Word[]> {
    const states = await db.userWordState.where('mastered').equals(1).toArray();
    const wordIds = states.map((s) => s.wordId);
    const words = await db.words.bulkGet(wordIds);
    const result: Word[] = [];
    for (let i = 0; i < states.length; i++) {
      const word = words[i];
      if (word) {
        const typed = states[i] as LocalUserWordState & { id: number };
        result.push(localWordToWord(word as LocalWord & { id: number }, typed));
      }
    }
    result.sort((a, b) => {
      const aTime = a.masteredAt?.getTime() ?? 0;
      const bTime = b.masteredAt?.getTime() ?? 0;
      return bTime - aTime;
    });
    return result;
  }

  async getMasteredPaginated(opts: {
    sort: import('./types').WordSortOrder;
    limit: number;
    offset: number;
  }): Promise<import('./types').PaginatedWords> {
    const all = await this.getMastered();
    if (opts.sort === 'alphabetical') {
      all.sort((a, b) => a.term.localeCompare(b.term, 'ja'));
    } else if (opts.sort === 'priority') {
      all.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    }
    // 'newest' is already default sort from getMastered (by masteredAt desc)
    return {
      words: all.slice(opts.offset, opts.offset + opts.limit),
      totalCount: all.length,
    };
  }

  async getById(id: string): Promise<Word | null> {
    const numId = Number(id);
    const word = await db.words.get(numId);
    if (!word) return null;
    const state = await getState(numId);
    return localWordToWord(word as LocalWord & { id: number }, state);
  }

  async getByIds(ids: string[]): Promise<Word[]> {
    const numIds = ids.map(Number);
    const words = await db.words.bulkGet(numIds);
    const result: Word[] = [];
    for (const word of words) {
      if (!word) continue;
      const typed = word as LocalWord & { id: number };
      const state = await getState(typed.id);
      result.push(localWordToWord(typed, state));
    }
    return result;
  }

  async search(query: string): Promise<Word[]> {
    const lower = query.toLowerCase();
    const [words, stateMap] = await Promise.all([
      db.words
        .filter(
          (w) =>
            w.term.toLowerCase().includes(lower) ||
            w.reading.toLowerCase().includes(lower) ||
            w.meaning.toLowerCase().includes(lower),
        )
        .toArray(),
      getAllStates(),
    ]);
    // Exclude mastered words (consistent with Supabase search using v_words_active)
    const result: Word[] = [];
    for (const w of words) {
      const typed = w as LocalWord & { id: number };
      const state = stateMap.get(typed.id) ?? null;
      if (state?.mastered) continue;
      result.push(localWordToWord(typed, state));
    }
    return result;
  }

  async create(input: CreateWordInput): Promise<Word> {
    const now = new Date();
    const localWord: LocalWord = {
      term: input.term,
      reading: input.reading,
      meaning: input.meaning,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      jlptLevel: input.jlptLevel ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const id = await db.words.add(localWord);
    const numId = id as number;

    // Create userWordState row
    const priority = input.priority ?? 2;
    await db.userWordState.add({
      wordId: numId,
      mastered: false,
      masteredAt: null,
      priority,
      isLeech: false,
      leechAt: null,
    });

    const state = await getState(numId);
    return localWordToWord({ ...localWord, id: numId }, state);
  }

  async update(id: string, input: UpdateWordInput): Promise<Word> {
    const numId = Number(id);
    const wordUpdate: Partial<LocalWord> = { updatedAt: new Date() };
    if (input.term !== undefined) wordUpdate.term = input.term;
    if (input.reading !== undefined) wordUpdate.reading = input.reading;
    if (input.meaning !== undefined) wordUpdate.meaning = input.meaning;
    if (input.notes !== undefined) wordUpdate.notes = input.notes;
    if (input.tags !== undefined) wordUpdate.tags = input.tags;
    if (input.jlptLevel !== undefined) wordUpdate.jlptLevel = input.jlptLevel;
    await db.words.update(numId, wordUpdate);

    // Update priority in userWordState if provided
    if (input.priority !== undefined) {
      const state = await getState(numId);
      if (state) {
        await db.userWordState.update(state.id, { priority: input.priority });
      }
    }

    const updated = await db.words.get(numId);
    if (!updated) throw new Error('Word not found');
    const state = await getState(numId);
    return localWordToWord(updated as LocalWord & { id: number }, state);
  }

  async setPriority(id: string, priority: number): Promise<void> {
    const numId = Number(id);
    const state = await getState(numId);
    if (state) {
      await db.userWordState.update(state.id, { priority });
      return;
    }
    await db.userWordState.add({
      wordId: numId,
      mastered: false,
      masteredAt: null,
      priority,
      isLeech: false,
      leechAt: null,
    });
  }

  async delete(id: string): Promise<void> {
    const numId = Number(id);
    await db.studyProgress.where('wordId').equals(numId).delete();
    await db.wordbookItems.where('wordId').equals(numId).delete();
    await db.userWordState.where('wordId').equals(numId).delete();
    await db.words.delete(numId);
  }

  async setMastered(id: string, mastered: boolean): Promise<Word> {
    const numId = Number(id);
    const now = new Date();

    // Upsert userWordState
    const existing = await getState(numId);
    if (existing) {
      await db.userWordState.update(existing.id, {
        mastered,
        masteredAt: mastered ? now : null,
      });
    } else {
      await db.userWordState.add({
        wordId: numId,
        mastered,
        masteredAt: mastered ? now : null,
        priority: 2,
        isLeech: false,
        leechAt: null,
      });
    }

    if (mastered) {
      await db.wordbookItems.where('wordId').equals(numId).delete();
    }

    const word = await db.words.get(numId);
    if (!word) throw new Error('Word not found');
    const state = await getState(numId);
    return localWordToWord(word as LocalWord & { id: number }, state);
  }
}

class IndexedDBStudyRepository implements StudyRepository {
  async getProgress(wordId: string): Promise<StudyProgress | null> {
    const progress = await db.studyProgress
      .where('wordId')
      .equals(Number(wordId))
      .first();
    if (!progress) return null;
    return localProgressToProgress(
      progress as LocalStudyProgress & { id: number },
    );
  }

  async getProgressByIds(wordIds: string[]): Promise<Map<string, StudyProgress>> {
    const map = new Map<string, StudyProgress>();
    if (wordIds.length === 0) return map;
    const numIds = wordIds.map(Number);
    const rows = await db.studyProgress
      .where('wordId')
      .anyOf(numIds)
      .toArray();
    for (const row of rows) {
      const progress = localProgressToProgress(row as LocalStudyProgress & { id: number });
      map.set(progress.wordId, progress);
    }
    return map;
  }

  async getDueCount(): Promise<number> {
    const now = new Date();
    const settings = await this.getQuizSettings();
    const todayStats = await this.getDailyStats(getLocalDateString());

    const allWords = await db.words.toArray();

    let reviewDue = 0;
    let totalNew = 0;

    for (const word of allWords) {
      const w = word as LocalWord & { id: number };
      const state = await getState(w.id);
      if (state?.mastered) continue;

      const progress = await db.studyProgress
        .where('wordId')
        .equals(w.id)
        .first();
      if (!progress) {
        totalNew++;
      } else if (progress.nextReview <= now) {
        reviewDue++;
      }
    }

    const remainingNew = Math.max(0, settings.newPerDay - (todayStats?.newCount ?? 0));
    const cappedNew = Math.min(totalNew, remainingNew);
    const totalDue = reviewDue + cappedNew;
    const remainingReviews = Math.max(0, settings.maxReviewsPerDay - (todayStats?.reviewCount ?? 0));

    return Math.min(totalDue, remainingReviews);
  }

  async getDueWords(limit = 20): Promise<WordWithProgress[]> {
    const now = new Date();
    const settings = await this.getQuizSettings();
    const todayStats = await this.getDailyStats(getLocalDateString());

    const allWords = await db.words.toArray();

    const reviewWords: WordWithProgress[] = [];
    const newWords: WordWithProgress[] = [];

    for (const word of allWords) {
      const w = word as LocalWord & { id: number };
      const state = await getState(w.id);
      if (state?.mastered) continue;

      const progress = await db.studyProgress
        .where('wordId')
        .equals(w.id)
        .first();

      if (!progress) {
        // Apply filters
        if (settings.jlptFilter !== null && w.jlptLevel !== settings.jlptFilter) continue;
        if (settings.priorityFilter !== null && (state?.priority ?? 2) !== settings.priorityFilter) continue;
        newWords.push({
          ...localWordToWord(w, state),
          progress: null,
        });
      } else if (progress.nextReview <= now) {
        reviewWords.push({
          ...localWordToWord(w, state),
          progress: localProgressToProgress(
            progress as LocalStudyProgress & { id: number },
          ),
        });
      }
    }

    const remainingNew = Math.max(0, settings.newPerDay - (todayStats?.newCount ?? 0));
    const cappedNewWords = newWords.slice(0, remainingNew);
    const candidates = [...reviewWords, ...cappedNewWords];

    const remainingReviews = Math.max(0, settings.maxReviewsPerDay - (todayStats?.reviewCount ?? 0));
    const effectiveLimit = Math.min(limit, remainingReviews);

    return selectDueWords(candidates, effectiveLimit, settings.jlptFilter);
  }

  async recordReview(wordId: string, quality: number): Promise<void> {
    const numWordId = Number(wordId);
    const existing = await db.studyProgress
      .where('wordId')
      .equals(numWordId)
      .first();

    const wasNew = !existing || (existing.reviewCount === 0 && (existing.cardState ?? 0) === 0);

    if (existing) {
      const current = localProgressToProgress(
        existing as LocalStudyProgress & { id: number },
      );
      const updated = reviewCard(quality, current);
      await db.studyProgress.update(existing.id!, {
        nextReview: updated.nextReview,
        intervalDays: updated.intervalDays,
        easeFactor: updated.easeFactor,
        reviewCount: updated.reviewCount,
        lastReviewedAt: updated.lastReviewedAt,
        stability: updated.stability,
        difficulty: updated.difficulty,
        elapsedDays: updated.elapsedDays,
        scheduledDays: updated.scheduledDays,
        learningSteps: updated.learningSteps,
        lapses: updated.lapses,
        cardState: updated.cardState,
      });
    } else {
      const initial = createInitialProgress(wordId);
      const updated = reviewCard(quality, initial);
      await db.studyProgress.add({
        wordId: numWordId,
        nextReview: updated.nextReview,
        intervalDays: updated.intervalDays,
        easeFactor: updated.easeFactor,
        reviewCount: updated.reviewCount,
        lastReviewedAt: updated.lastReviewedAt,
        stability: updated.stability,
        difficulty: updated.difficulty,
        elapsedDays: updated.elapsedDays,
        scheduledDays: updated.scheduledDays,
        learningSteps: updated.learningSteps,
        lapses: updated.lapses,
        cardState: updated.cardState,
      });
    }

    // Track daily stats
    const today = getLocalDateString();
    await this.incrementDailyStats(today, wasNew, quality);

    // Upgrade priority to high when rated "Again" — now in userWordState
    if (quality === 0) {
      const state = await getState(numWordId);
      if (state && state.priority > 1) {
        await db.userWordState.update(state.id, { priority: 1 });
      }
      // Check leech threshold
      await this.checkAndMarkLeech(wordId);
    }
  }

  async getQuizSettings(): Promise<QuizSettings> {
    const settings = await db.quizSettings.toCollection().first();
    if (!settings) return { ...DEFAULT_QUIZ_SETTINGS };
    return {
      newPerDay: settings.newPerDay,
      maxReviewsPerDay: settings.maxReviewsPerDay,
      jlptFilter: settings.jlptFilter,
      priorityFilter: settings.priorityFilter,
      cardDirection: (settings.cardDirection ?? 'term_first') as QuizSettings['cardDirection'],
      sessionSize: settings.sessionSize ?? 20,
      leechThreshold: settings.leechThreshold ?? 8,
    };
  }

  async updateQuizSettings(update: Partial<QuizSettings>): Promise<void> {
    const existing = await db.quizSettings.toCollection().first();
    if (existing) {
      await db.quizSettings.update(existing.id!, update);
    } else {
      await db.quizSettings.add({
        ...DEFAULT_QUIZ_SETTINGS,
        ...update,
      });
    }
  }

  async getDailyStats(date: string): Promise<DailyStats | null> {
    const stat = await db.dailyStats.where('date').equals(date).first();
    if (!stat) return null;
    return {
      id: String(stat.id!),
      date: stat.date,
      newCount: stat.newCount,
      reviewCount: stat.reviewCount,
      againCount: stat.againCount,
      reviewAgainCount: stat.reviewAgainCount ?? 0,
      newAgainCount: stat.newAgainCount ?? 0,
      hardCount: stat.hardCount ?? 0,
      goodCount: stat.goodCount ?? 0,
      easyCount: stat.easyCount ?? 0,
      masteredInSessionCount: stat.masteredInSessionCount ?? 0,
      practiceCount: stat.practiceCount ?? 0,
      practiceKnownCount: stat.practiceKnownCount ?? 0,
    };
  }

  async incrementDailyStats(date: string, isNew: boolean, quality: number): Promise<void> {
    const isAgain = quality === 0;
    const existing = await db.dailyStats.where('date').equals(date).first();
    if (existing) {
      await db.dailyStats.update(existing.id!, {
        newCount: existing.newCount + (isNew ? 1 : 0),
        reviewCount: existing.reviewCount + 1,
        againCount: existing.againCount + (isAgain ? 1 : 0),
        reviewAgainCount: (existing.reviewAgainCount ?? 0) + (!isNew && isAgain ? 1 : 0),
        newAgainCount: (existing.newAgainCount ?? 0) + (isNew && isAgain ? 1 : 0),
        hardCount: (existing.hardCount ?? 0) + (quality === 1 ? 1 : 0),
        goodCount: (existing.goodCount ?? 0) + (quality === 2 ? 1 : 0),
        easyCount: (existing.easyCount ?? 0) + (quality === 3 ? 1 : 0),
      });
    } else {
      await db.dailyStats.add({
        date,
        newCount: isNew ? 1 : 0,
        reviewCount: 1,
        againCount: isAgain ? 1 : 0,
        reviewAgainCount: !isNew && isAgain ? 1 : 0,
        newAgainCount: isNew && isAgain ? 1 : 0,
        hardCount: quality === 1 ? 1 : 0,
        goodCount: quality === 2 ? 1 : 0,
        easyCount: quality === 3 ? 1 : 0,
        masteredInSessionCount: 0,
        practiceCount: 0,
        practiceKnownCount: 0,
      });
    }
  }

  async incrementMasteredStats(date: string): Promise<void> {
    const existing = await db.dailyStats.where('date').equals(date).first();
    if (existing) {
      await db.dailyStats.update(existing.id!, {
        masteredInSessionCount: (existing.masteredInSessionCount ?? 0) + 1,
      });
    } else {
      await db.dailyStats.add({
        date,
        newCount: 0,
        reviewCount: 0,
        againCount: 0,
        reviewAgainCount: 0,
        newAgainCount: 0,
        hardCount: 0,
        goodCount: 0,
        easyCount: 0,
        masteredInSessionCount: 1,
        practiceCount: 0,
        practiceKnownCount: 0,
      });
    }
  }

  async incrementPracticeStats(date: string, known: boolean): Promise<void> {
    const existing = await db.dailyStats.where('date').equals(date).first();
    if (existing) {
      await db.dailyStats.update(existing.id!, {
        practiceCount: (existing.practiceCount ?? 0) + 1,
        practiceKnownCount: (existing.practiceKnownCount ?? 0) + (known ? 1 : 0),
      });
    } else {
      await db.dailyStats.add({
        date,
        newCount: 0,
        reviewCount: 0,
        againCount: 0,
        reviewAgainCount: 0,
        newAgainCount: 0,
        hardCount: 0,
        goodCount: 0,
        easyCount: 0,
        masteredInSessionCount: 0,
        practiceCount: 1,
        practiceKnownCount: known ? 1 : 0,
      });
    }
  }

  async checkAndMarkLeech(wordId: string): Promise<boolean> {
    const settings = await this.getQuizSettings();
    const progress = await this.getProgress(wordId);
    if (!progress || progress.lapses < settings.leechThreshold) return false;

    const numWordId = Number(wordId);
    const state = await getState(numWordId);
    if (!state || state.isLeech) return false;

    await db.userWordState.update(state.id, {
      isLeech: true,
      leechAt: new Date(),
    });
    return true;
  }

  async getStreakDays(): Promise<number> {
    const stats = await db.dailyStats.orderBy('date').reverse().limit(100).toArray();
    if (stats.length === 0) return 0;

    let streak = 0;
    let checkDate = getLocalDateString();

    // If today has no stats, check if yesterday does
    if (stats[0].date !== checkDate) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      checkDate = getLocalDateString(yesterday);
      if (stats[0].date !== checkDate) return 0;
    }

    const dateSet = new Set(stats.map((s) => s.date));
    const current = new Date(checkDate + 'T00:00:00');
    while (dateSet.has(getLocalDateString(current))) {
      streak++;
      current.setDate(current.getDate() - 1);
    }

    return streak;
  }

  async getDailyStatsRange(startDate: string, endDate: string): Promise<DailyStats[]> {
    const stats = await db.dailyStats
      .where('date')
      .between(startDate, endDate, true, true)
      .toArray();
    stats.sort((a, b) => a.date.localeCompare(b.date));
    return stats.map((s) => ({
      id: String(s.id!),
      date: s.date,
      newCount: s.newCount,
      reviewCount: s.reviewCount,
      againCount: s.againCount,
      reviewAgainCount: s.reviewAgainCount ?? 0,
      newAgainCount: s.newAgainCount ?? 0,
      hardCount: s.hardCount ?? 0,
      goodCount: s.goodCount ?? 0,
      easyCount: s.easyCount ?? 0,
      masteredInSessionCount: s.masteredInSessionCount ?? 0,
      practiceCount: s.practiceCount ?? 0,
      practiceKnownCount: s.practiceKnownCount ?? 0,
    }));
  }

  async getCardStateDistribution(): Promise<{ state: number; count: number }[]> {
    const allProgress = await db.studyProgress.toArray();
    const counts = new Map<number, number>();
    for (const p of allProgress) {
      const state = p.cardState ?? 0;
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([state, count]) => ({ state, count }));
  }

  async getTotalReviewedAllTime(): Promise<number> {
    const stats = await db.dailyStats.toArray();
    let total = 0;
    for (const s of stats) {
      total += s.reviewCount;
    }
    return total;
  }

  async getAchievements(): Promise<Achievement[]> {
    const achievements = await db.achievements.orderBy('unlockedAt').reverse().toArray();
    return achievements.map((a) => ({
      id: String(a.id!),
      type: a.type as Achievement['type'],
      unlockedAt: a.unlockedAt,
    }));
  }

  async unlockAchievement(type: string): Promise<Achievement | null> {
    const existing = await db.achievements.where('type').equals(type).first();
    if (existing) return null;

    const now = new Date();
    const id = await db.achievements.add({ type, unlockedAt: now });
    return {
      id: String(id),
      type: type as Achievement['type'],
      unlockedAt: now,
    };
  }
}

class IndexedDBWordbookRepository implements WordbookRepository {
  async getAll(): Promise<WordbookWithCount[]> {
    const [wordbooks, allItems, stateMap] = await Promise.all([
      db.wordbooks.orderBy('createdAt').reverse().toArray(),
      db.wordbookItems.toArray(),
      getAllStates(),
    ]);

    // Group items by wordbookId
    const itemsByWorkbook = new Map<number, typeof allItems>();
    for (const item of allItems) {
      const list = itemsByWorkbook.get(item.wordbookId);
      if (list) list.push(item);
      else itemsByWorkbook.set(item.wordbookId, [item]);
    }

    return wordbooks.map((wb) => {
      const typedWb = wb as LocalWordbook & { id: number };
      const items = itemsByWorkbook.get(typedWb.id) ?? [];
      let masteredCount = 0;
      for (const item of items) {
        if (stateMap.get(item.wordId)?.mastered) masteredCount++;
      }
      return { ...localWordbookToWordbook(typedWb), wordCount: items.length, importCount: 0, masteredCount };
    });
  }

  async getById(id: string): Promise<Wordbook | null> {
    const wb = await db.wordbooks.get(Number(id));
    if (!wb) return null;
    return localWordbookToWordbook(wb as LocalWordbook & { id: number });
  }

  async create(input: CreateWordbookInput): Promise<Wordbook> {
    const now = new Date();
    const local: LocalWordbook = {
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const id = await db.wordbooks.add(local);
    return localWordbookToWordbook({ ...local, id: id as number });
  }

  async update(id: string, input: UpdateWordbookInput): Promise<Wordbook> {
    const numId = Number(id);
    const updateData: Partial<LocalWordbook> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    await db.wordbooks.update(numId, updateData);
    const updated = await db.wordbooks.get(numId);
    if (!updated) throw new Error('Wordbook not found');
    return localWordbookToWordbook(updated as LocalWordbook & { id: number });
  }

  async delete(id: string): Promise<void> {
    const numId = Number(id);
    await db.wordbookItems.where('wordbookId').equals(numId).delete();
    await db.wordbooks.delete(numId);
  }

  async getWords(wordbookId: string): Promise<Word[]> {
    const numId = Number(wordbookId);
    const items = await db.wordbookItems
      .where('wordbookId')
      .equals(numId)
      .toArray();
    const wordIds = items.map((item) => item.wordId);
    const [rawWords, stateMap] = await Promise.all([
      db.words.bulkGet(wordIds),
      getAllStates(),
    ]);
    const words: Word[] = [];
    for (let i = 0; i < items.length; i++) {
      const word = rawWords[i];
      if (word) {
        words.push(localWordToWord(
          word as LocalWord & { id: number },
          stateMap.get(items[i].wordId) ?? null,
        ));
      }
    }
    return words;
  }

  async getWordsPaginated(
    wordbookId: string,
    opts: { sort: import('./types').WordSortOrder; limit: number; offset: number },
  ): Promise<import('./types').PaginatedWords> {
    const all = await this.getWords(wordbookId);
    if (opts.sort === 'alphabetical') {
      all.sort((a, b) => a.term.localeCompare(b.term, 'ja'));
    } else {
      all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return {
      words: all.slice(opts.offset, opts.offset + opts.limit),
      totalCount: all.length,
    };
  }

  async addWord(wordbookId: string, wordId: string): Promise<void> {
    const numWordId = Number(wordId);
    const word = await db.words.get(numWordId);
    if (!word) throw new Error('Word not found');

    // Check mastered from userWordState
    const state = await getState(numWordId);
    if (state?.mastered) throw new Error('Cannot add mastered word to wordbook');

    const existing = await db.wordbookItems
      .where('[wordbookId+wordId]')
      .equals([Number(wordbookId), numWordId])
      .first();
    if (existing) return;

    await db.wordbookItems.add({
      wordbookId: Number(wordbookId),
      wordId: numWordId,
    });
  }

  async addWords(wordbookId: string, wordIds: string[]): Promise<void> {
    const numWordbookId = Number(wordbookId);
    await db.transaction('rw', [db.words, db.wordbookItems, db.userWordState], async () => {
      for (const wordId of wordIds) {
        const numWordId = Number(wordId);
        const word = await db.words.get(numWordId);
        if (!word) continue;
        const state = await getState(numWordId);
        if (state?.mastered) continue;
        const existing = await db.wordbookItems
          .where('[wordbookId+wordId]')
          .equals([numWordbookId, numWordId])
          .first();
        if (!existing) {
          await db.wordbookItems.add({ wordbookId: numWordbookId, wordId: numWordId });
        }
      }
    });
  }

  async removeWord(wordbookId: string, wordId: string): Promise<void> {
    await db.wordbookItems
      .where('[wordbookId+wordId]')
      .equals([Number(wordbookId), Number(wordId)])
      .delete();
  }

  async getWordbooksForWord(wordId: string): Promise<Wordbook[]> {
    const items = await db.wordbookItems
      .where('wordId')
      .equals(Number(wordId))
      .toArray();
    const wordbooks: Wordbook[] = [];
    for (const item of items) {
      const wb = await db.wordbooks.get(item.wordbookId);
      if (wb) {
        wordbooks.push(localWordbookToWordbook(wb as LocalWordbook & { id: number }));
      }
    }
    return wordbooks;
  }

  // Shared features not available in guest mode
  async getSubscribed(): Promise<WordbookWithCount[]> {
    return [];
  }

  async browseShared(): Promise<SharedWordbookListItem[]> {
    return [];
  }

  async subscribe(): Promise<void> {
    throw new Error('Sign in required to subscribe to shared wordbooks');
  }

  async unsubscribe(): Promise<void> {
    throw new Error('Sign in required to unsubscribe from shared wordbooks');
  }

  async copySharedWordbook(): Promise<Wordbook> {
    throw new Error('Sign in required to copy shared wordbooks');
  }
}

export class IndexedDBRepository implements DataRepository {
  words = new IndexedDBWordRepository();
  study = new IndexedDBStudyRepository();
  wordbooks = new IndexedDBWordbookRepository();

  async exportAll(): Promise<ExportData> {
    const words = await this.words.getAll();
    const studyProgress: StudyProgress[] = [];
    for (const word of words) {
      const progress = await this.study.getProgress(word.id);
      if (progress) studyProgress.push(progress);
    }

    const allWordbooks = await db.wordbooks.toArray();
    const wordbooks = allWordbooks.map((wb) => {
      const typedWb = wb as LocalWordbook & { id: number };
      return {
        id: String(typedWb.id),
        name: typedWb.name,
        description: typedWb.description,
        createdAt: typedWb.createdAt.toISOString(),
        updatedAt: typedWb.updatedAt.toISOString(),
      };
    });

    const allItems = await db.wordbookItems.toArray();
    const wordbookItems = allItems.map((item) => ({
      wordbookId: String(item.wordbookId),
      wordId: String(item.wordId),
      addedAt: new Date().toISOString(),
    }));

    // Export userWordState
    const allStates = await db.userWordState.toArray();
    const userWordState: UserWordStateExport[] = allStates.map((s) => ({
      wordId: String(s.wordId),
      mastered: s.mastered,
      masteredAt: s.masteredAt?.toISOString() ?? null,
      priority: s.priority,
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
    await db.transaction(
      'rw',
      [db.words, db.userWordState, db.studyProgress, db.wordbooks, db.wordbookItems],
      async () => {
        const wordIdMap = new Map<string, number>();

        for (const word of data.words) {
          const id = await db.words.add({
            term: word.term,
            reading: word.reading,
            meaning: word.meaning,
            notes: word.notes,
            tags: word.tags,
            jlptLevel: word.jlptLevel,
            createdAt: new Date(word.createdAt),
            updatedAt: new Date(word.updatedAt),
          });
          const numId = id as number;
          wordIdMap.set(word.id, numId);

          // For v1/v2, read mastered/priority from word object
          if (data.version !== 3) {
            await db.userWordState.add({
              wordId: numId,
              mastered: word.mastered ?? false,
              masteredAt: word.masteredAt ? new Date(word.masteredAt) : null,
              priority: word.priority ?? 2,
              isLeech: false,
              leechAt: null,
            });
          }

          const progress = data.studyProgress.find((p) => p.wordId === word.id);
          if (progress) {
            await db.studyProgress.add({
              wordId: numId,
              nextReview: new Date(progress.nextReview),
              intervalDays: progress.intervalDays,
              easeFactor: progress.easeFactor,
              reviewCount: progress.reviewCount,
              lastReviewedAt: progress.lastReviewedAt
                ? new Date(progress.lastReviewedAt)
                : null,
              stability: 0,
              difficulty: 0,
              elapsedDays: 0,
              scheduledDays: 0,
              learningSteps: 0,
              lapses: 0,
              cardState: 0,
            });
          }
        }

        // For v3, import userWordState from separate array
        if (data.version === 3 && data.userWordState) {
          for (const uws of data.userWordState) {
            const numId = wordIdMap.get(uws.wordId);
            if (!numId) continue;
            await db.userWordState.add({
              wordId: numId,
              mastered: uws.mastered,
              masteredAt: uws.masteredAt ? new Date(uws.masteredAt) : null,
              priority: uws.priority,
              isLeech: false,
              leechAt: null,
            });
          }
        }

        if (data.version === 2 || data.version === 3) {
          const wordbookIdMap = new Map<string, number>();
          for (const wb of data.wordbooks) {
            const id = await db.wordbooks.add({
              name: wb.name,
              description: wb.description,
              createdAt: new Date(wb.createdAt),
              updatedAt: new Date(wb.updatedAt),
            });
            wordbookIdMap.set(wb.id, id as number);
          }

          for (const item of data.wordbookItems) {
            const wordbookId = wordbookIdMap.get(item.wordbookId);
            const wordId = wordIdMap.get(item.wordId);
            if (wordbookId && wordId) {
              await db.wordbookItems.add({ wordbookId, wordId });
            }
          }
        }
      },
    );
  }
}
