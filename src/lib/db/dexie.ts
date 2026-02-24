import Dexie, { type Table } from 'dexie';

export interface LocalWord {
  id?: number;
  term: string;
  reading: string;
  meaning: string;
  notes: string | null;
  tags: string[];
  jlptLevel: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocalUserWordState {
  id?: number;
  wordId: number;
  mastered: boolean;
  masteredAt: Date | null;
  priority: number;
}

export interface LocalStudyProgress {
  id?: number;
  wordId: number;
  nextReview: Date;
  intervalDays: number;
  easeFactor: number;
  reviewCount: number;
  lastReviewedAt: Date | null;
  // FSRS fields
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  lapses: number;
  cardState: number;
}

export interface LocalWordbook {
  id?: number;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocalWordbookItem {
  id?: number;
  wordbookId: number;
  wordId: number;
}

export interface LocalQuizSettings {
  id?: number;
  newPerDay: number;
  maxReviewsPerDay: number;
  jlptFilter: number | null;
  priorityFilter: number | null;
  newCardOrder?: string; // deprecated, kept for backward compat with existing DB rows
}

export interface LocalDailyStats {
  id?: number;
  date: string; // YYYY-MM-DD
  newCount: number;
  reviewCount: number;
  againCount: number;
}

export interface LocalAchievement {
  id?: number;
  type: string;
  unlockedAt: Date;
}

class VocaBookDB extends Dexie {
  words!: Table<LocalWord, number>;
  userWordState!: Table<LocalUserWordState, number>;
  studyProgress!: Table<LocalStudyProgress, number>;
  wordbooks!: Table<LocalWordbook, number>;
  wordbookItems!: Table<LocalWordbookItem, number>;
  quizSettings!: Table<LocalQuizSettings, number>;
  dailyStats!: Table<LocalDailyStats, number>;
  achievements!: Table<LocalAchievement, number>;

  constructor() {
    super('nihongo-vocabook');
    this.version(1).stores({
      words: '++id, term, reading, meaning, *tags, jlptLevel, createdAt',
      studyProgress: '++id, wordId, nextReview',
    });

    this.version(2)
      .stores({
        words: '++id, term, reading, meaning, *tags, jlptLevel, mastered, createdAt',
        studyProgress: '++id, wordId, nextReview',
        wordbooks: '++id, name, createdAt',
        wordbookItems: '++id, wordbookId, wordId, [wordbookId+wordId]',
      })
      .upgrade((tx) => {
        return tx
          .table('words')
          .toCollection()
          .modify((word) => {
            if (word.mastered === undefined) {
              word.mastered = false;
              word.masteredAt = null;
            }
          });
      });

    this.version(3)
      .stores({
        words: '++id, term, reading, meaning, *tags, jlptLevel, mastered, createdAt',
        studyProgress: '++id, wordId, nextReview',
        wordbooks: '++id, name, createdAt',
        wordbookItems: '++id, wordbookId, wordId, [wordbookId+wordId]',
        quizSettings: '++id',
        dailyStats: '++id, date',
        achievements: '++id, type',
      })
      .upgrade((tx) => {
        return tx
          .table('studyProgress')
          .toCollection()
          .modify((progress) => {
            if (progress.stability === undefined) {
              progress.stability = 0;
              progress.difficulty = 0;
              progress.elapsedDays = 0;
              progress.scheduledDays = 0;
              progress.learningSteps = 0;
              progress.lapses = 0;
              progress.cardState = progress.reviewCount > 0 ? 2 : 0;
            }
          });
      });

    this.version(4)
      .stores({
        words: '++id, term, reading, meaning, *tags, jlptLevel, createdAt',
        userWordState: '++id, wordId, mastered',
        studyProgress: '++id, wordId, nextReview',
        wordbooks: '++id, name, createdAt',
        wordbookItems: '++id, wordbookId, wordId, [wordbookId+wordId]',
        quizSettings: '++id',
        dailyStats: '++id, date',
        achievements: '++id, type',
      })
      .upgrade(async (tx) => {
        // Migrate mastered/masteredAt from words → userWordState, set default priority=2
        const words = tx.table('words');
        const uws = tx.table('userWordState');
        await words.toCollection().each(async (word) => {
          await uws.add({
            wordId: word.id,
            mastered: word.mastered ?? false,
            masteredAt: word.masteredAt ?? null,
            priority: (word as Record<string, unknown>).priority as number ?? 2,
          });
        });
        // Remove mastered/masteredAt from words rows
        await words.toCollection().modify((word) => {
          delete word.mastered;
          delete word.masteredAt;
          delete (word as Record<string, unknown>).priority;
        });
      });
  }
}

export const db = new VocaBookDB();
