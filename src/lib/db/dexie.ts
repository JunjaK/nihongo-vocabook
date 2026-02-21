import Dexie, { type Table } from 'dexie';

export interface LocalWord {
  id?: number;
  term: string;
  reading: string;
  meaning: string;
  notes: string | null;
  tags: string[];
  jlptLevel: number | null;
  mastered: boolean;
  masteredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocalStudyProgress {
  id?: number;
  wordId: number;
  nextReview: Date;
  intervalDays: number;
  easeFactor: number;
  reviewCount: number;
  lastReviewedAt: Date | null;
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

class VocaBookDB extends Dexie {
  words!: Table<LocalWord, number>;
  studyProgress!: Table<LocalStudyProgress, number>;
  wordbooks!: Table<LocalWordbook, number>;
  wordbookItems!: Table<LocalWordbookItem, number>;

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
  }
}

export const db = new VocaBookDB();
