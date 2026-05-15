import type {
  Word,
  WordExample,
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
import type {
  ChatMessage,
  ChatScope,
  ChatSession,
  ChatMessageStatus,
  ChatFinishReason,
  ToolExecutionRecord,
  ToolCallStatus,
  AiTelemetryEvent,
} from '@/types/chat';

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
  getExistingTerms(terms: string[]): Promise<Set<string>>;
  create(word: CreateWordInput): Promise<Word>;
  update(id: string, word: UpdateWordInput): Promise<Word>;
  setPriority(id: string, priority: number): Promise<void>;
  delete(id: string): Promise<void>;
  setMastered(id: string, mastered: boolean): Promise<Word>;
  getExamples(dictionaryEntryId: string): Promise<WordExample[]>;
  getExamplesForDictionaryEntries(
    dictionaryEntryIds: string[],
  ): Promise<Map<string, WordExample[]>>;
  /** Append a user-authored or AI-proposed example to a word's dictionary entry. */
  addExample(
    wordId: string,
    input: {
      sentenceJa: string;
      sentenceReading?: string;
      sentenceMeaning?: string;
      source?: 'manual' | 'ai_generated';
    },
  ): Promise<WordExample>;
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
  incrementDailyStats(date: string, isNew: boolean, quality: number): Promise<void>;
  incrementMasteredStats(date: string): Promise<void>;
  incrementPracticeStats(date: string, known: boolean): Promise<void>;
  checkAndMarkLeech(
    wordId: string,
    hint?: { lapses: number; userId: string },
  ): Promise<boolean>;
  getStreakDays(): Promise<number>;
  getDailyStatsRange(startDate: string, endDate: string): Promise<DailyStats[]>;
  getCardStateDistribution(): Promise<{ state: number; count: number }[]>;
  getTotalReviewedAllTime(): Promise<number>;
  getAchievements(): Promise<Achievement[]>;
  unlockAchievement(type: string): Promise<Achievement | null>;
  resetStudyData(): Promise<void>;
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
  copySharedWordbook(wordbookId: string, overrides?: { name: string; description: string | null }): Promise<Wordbook>;
}

export interface ChatRepository {
  // Sessions
  getCurrentSession(): Promise<ChatSession | null>;
  listSessions(limit?: number): Promise<ChatSession[]>;
  createSession(scope: ChatScope, contextSnapshot?: unknown): Promise<ChatSession>;
  updateSessionTitle(sessionId: string, title: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  clearAllSessions(): Promise<void>;

  // Messages
  appendMessage(message: ChatMessage): Promise<void>;
  updateMessageStatus(
    messageId: string,
    status: ChatMessageStatus,
    patch?: {
      finishReason?: ChatFinishReason;
      inputTokens?: number;
      outputTokens?: number;
      modelVariant?: string;
      errorCode?: string;
      errorMessage?: string;
      content?: ChatMessage['content'];
      toolCalls?: ChatMessage['toolCalls'];
    },
  ): Promise<void>;
  listMessages(
    sessionId: string,
    limit?: number,
    before?: number,
  ): Promise<ChatMessage[]>;
  /**
   * Set or clear a user feedback rating on a single assistant message.
   * Pass `null` to clear an existing rating.
   */
  setMessageFeedback(
    messageId: string,
    feedback: 'thumbs_up' | 'thumbs_down' | null,
  ): Promise<void>;

  /**
   * Save an auto-generated context summary so the next inference can use it
   * instead of trimming oldest messages. Pass `null`/undefined to clear.
   */
  setSessionSummary(
    sessionId: string,
    summary: string | null,
    summarizedThroughMessageId: string | null,
    summarizedMessageCount: number,
  ): Promise<void>;

  /** Bulk-upload anonymous telemetry. Opt-in (caller checks the pref). */
  uploadTelemetry(events: AiTelemetryEvent[]): Promise<void>;

  // Tool executions
  recordToolExecution(execution: ToolExecutionRecord): Promise<void>;
  updateToolExecution(
    id: string,
    patch: {
      status?: ToolCallStatus;
      result?: unknown;
      errorMessage?: string;
      durationMs?: number;
      completedAt?: number;
    },
  ): Promise<void>;
}

export interface DataRepository {
  words: WordRepository;
  study: StudyRepository;
  wordbooks: WordbookRepository;
  chat: ChatRepository;
  exportAll(): Promise<ExportData>;
  importAll(data: ImportData): Promise<void>;
}
