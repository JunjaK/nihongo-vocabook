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

export interface WordRepository {
  getAll(): Promise<Word[]>;
  getNonMastered(): Promise<Word[]>;
  getMastered(): Promise<Word[]>;
  getById(id: string): Promise<Word | null>;
  search(query: string): Promise<Word[]>;
  create(word: CreateWordInput): Promise<Word>;
  update(id: string, word: UpdateWordInput): Promise<Word>;
  delete(id: string): Promise<void>;
  setMastered(id: string, mastered: boolean): Promise<Word>;
}

export interface StudyRepository {
  getProgress(wordId: string): Promise<StudyProgress | null>;
  getDueWords(limit?: number): Promise<WordWithProgress[]>;
  recordReview(wordId: string, quality: number): Promise<void>;
}

export interface WordbookRepository {
  getAll(): Promise<WordbookWithCount[]>;
  getById(id: string): Promise<Wordbook | null>;
  create(input: CreateWordbookInput): Promise<Wordbook>;
  update(id: string, input: UpdateWordbookInput): Promise<Wordbook>;
  delete(id: string): Promise<void>;
  getWords(wordbookId: string): Promise<Word[]>;
  addWord(wordbookId: string, wordId: string): Promise<void>;
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
