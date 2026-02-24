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

export type WordSortOrder = 'priority' | 'newest' | 'alphabetical';

export interface PaginatedWords {
  words: Word[];
  totalCount: number;
}

export interface WordRepository {
  getAll(): Promise<Word[]>;
  getNonMastered(): Promise<Word[]>;
  getNonMasteredPaginated(opts: {
    sort: WordSortOrder;
    limit: number;
    offset: number;
  }): Promise<PaginatedWords>;
  getMastered(): Promise<Word[]>;
  getMasteredPaginated(opts: {
    sort: WordSortOrder;
    limit: number;
    offset: number;
  }): Promise<PaginatedWords>;
  getById(id: string): Promise<Word | null>;
  getByIds(ids: string[]): Promise<Word[]>;
  search(query: string): Promise<Word[]>;
  create(word: CreateWordInput): Promise<Word>;
  update(id: string, word: UpdateWordInput): Promise<Word>;
  setPriority(id: string, priority: number): Promise<void>;
  delete(id: string): Promise<void>;
  setMastered(id: string, mastered: boolean): Promise<Word>;
}

export interface StudyRepository {
  getProgress(wordId: string): Promise<StudyProgress | null>;
  getProgressByIds(wordIds: string[]): Promise<Map<string, StudyProgress>>;
  getDueCount(): Promise<number>;
  getDueWords(limit?: number): Promise<WordWithProgress[]>;
  recordReview(wordId: string, quality: number): Promise<void>;
  getQuizSettings(): Promise<QuizSettings>;
  updateQuizSettings(settings: Partial<QuizSettings>): Promise<void>;
  getDailyStats(date: string): Promise<DailyStats | null>;
  incrementDailyStats(date: string, isNew: boolean, isAgain: boolean): Promise<void>;
  incrementPracticeStats(date: string, known: boolean): Promise<void>;
  checkAndMarkLeech(wordId: string): Promise<boolean>;
  getStreakDays(): Promise<number>;
  getAchievements(): Promise<Achievement[]>;
  unlockAchievement(type: string): Promise<Achievement | null>;
}

export interface WordbookRepository {
  getAll(): Promise<WordbookWithCount[]>;
  getById(id: string): Promise<Wordbook | null>;
  create(input: CreateWordbookInput): Promise<Wordbook>;
  update(id: string, input: UpdateWordbookInput): Promise<Wordbook>;
  delete(id: string): Promise<void>;
  getWords(wordbookId: string): Promise<Word[]>;
  getWordsPaginated(wordbookId: string, opts: {
    sort: WordSortOrder;
    limit: number;
    offset: number;
  }): Promise<PaginatedWords>;
  addWord(wordbookId: string, wordId: string): Promise<void>;
  addWords(wordbookId: string, wordIds: string[]): Promise<void>;
  removeWord(wordbookId: string, wordId: string): Promise<void>;
  getWordbooksForWord(wordId: string): Promise<Wordbook[]>;
  getSubscribed(): Promise<WordbookWithCount[]>;
  browseShared(): Promise<SharedWordbookListItem[]>;
  subscribe(wordbookId: string): Promise<void>;
  unsubscribe(wordbookId: string): Promise<void>;
  copySharedWordbook(wordbookId: string): Promise<Wordbook>;
}

export interface DataRepository {
  words: WordRepository;
  study: StudyRepository;
  wordbooks: WordbookRepository;
  exportAll(): Promise<ExportData>;
  importAll(data: ImportData): Promise<void>;
}
