import { DEFAULT_QUIZ_SETTINGS } from '@/types/quiz';
import type {
  DataRepository,
  PaginatedWords,
  StudyRepository,
  WordRepository,
  WordbookRepository,
} from './types';

// Guest mode is intentionally view-only after the dict-first save flow
// (commit 7c63165) — guests can't persist data anywhere. This stub satisfies
// the DataRepository interface so guest pages don't crash on `useRepository()`:
// reads return empty defaults, writes throw LOGIN_REQUIRED.
//
// All persistent guest storage (Dexie/IndexedDB, local-data migration) was
// removed alongside this file's introduction.

const LOGIN_REQUIRED = () => Promise.reject(new Error('LOGIN_REQUIRED'));

const emptyPaginated: PaginatedWords = { words: [], totalCount: 0 };

const wordRepo: WordRepository = {
  getAll: () => Promise.resolve([]),
  getNonMastered: () => Promise.resolve([]),
  getNonMasteredPaginated: () => Promise.resolve(emptyPaginated),
  getMastered: () => Promise.resolve([]),
  getMasteredPaginated: () => Promise.resolve(emptyPaginated),
  getById: () => Promise.resolve(null),
  getByIds: () => Promise.resolve([]),
  search: () => Promise.resolve([]),
  getExistingTerms: () => Promise.resolve(new Set<string>()),
  create: LOGIN_REQUIRED,
  update: LOGIN_REQUIRED,
  setPriority: LOGIN_REQUIRED,
  delete: LOGIN_REQUIRED,
  setMastered: LOGIN_REQUIRED,
  getExamples: () => Promise.resolve([]),
  getExamplesForDictionaryEntries: () => Promise.resolve(new Map()),
};

const studyRepo: StudyRepository = {
  getProgress: () => Promise.resolve(null),
  getProgressByIds: () => Promise.resolve(new Map()),
  getDueCount: () => Promise.resolve(0),
  getDueWords: () => Promise.resolve([]),
  recordReview: LOGIN_REQUIRED,
  getQuizSettings: () => Promise.resolve(DEFAULT_QUIZ_SETTINGS),
  updateQuizSettings: LOGIN_REQUIRED,
  getDailyStats: () => Promise.resolve(null),
  incrementDailyStats: LOGIN_REQUIRED,
  incrementMasteredStats: LOGIN_REQUIRED,
  incrementPracticeStats: LOGIN_REQUIRED,
  checkAndMarkLeech: () => Promise.resolve(false),
  getStreakDays: () => Promise.resolve(0),
  getDailyStatsRange: () => Promise.resolve([]),
  getCardStateDistribution: () => Promise.resolve([]),
  getTotalReviewedAllTime: () => Promise.resolve(0),
  getAchievements: () => Promise.resolve([]),
  unlockAchievement: () => Promise.resolve(null),
  resetStudyData: LOGIN_REQUIRED,
};

const wordbookRepo: WordbookRepository = {
  getAll: () => Promise.resolve([]),
  getById: () => Promise.resolve(null),
  create: LOGIN_REQUIRED,
  update: LOGIN_REQUIRED,
  delete: LOGIN_REQUIRED,
  getWords: () => Promise.resolve([]),
  getWordsPaginated: () => Promise.resolve(emptyPaginated),
  addWord: LOGIN_REQUIRED,
  addWords: LOGIN_REQUIRED,
  removeWord: LOGIN_REQUIRED,
  getWordbooksForWord: () => Promise.resolve([]),
  getSubscribed: () => Promise.resolve([]),
  browseShared: () => Promise.resolve([]),
  subscribe: LOGIN_REQUIRED,
  unsubscribe: LOGIN_REQUIRED,
  copySharedWordbook: LOGIN_REQUIRED,
};

export const guestRepository: DataRepository = {
  words: wordRepo,
  study: studyRepo,
  wordbooks: wordbookRepo,
  exportAll: () =>
    Promise.resolve({
      version: 3,
      exportedAt: new Date().toISOString(),
      words: [],
      studyProgress: [],
      wordbooks: [],
      wordbookItems: [],
      userWordState: [],
    }),
  importAll: LOGIN_REQUIRED,
};
