export interface Word {
  id: string;
  term: string;
  reading: string;
  meaning: string;
  notes: string | null;
  tags: string[];
  jlptLevel: number | null;
  priority: number;
  mastered: boolean;
  masteredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWordInput {
  term: string;
  reading: string;
  meaning: string;
  notes?: string | null;
  tags?: string[];
  jlptLevel?: number | null;
  priority?: number;
}

export interface UpdateWordInput {
  term?: string;
  reading?: string;
  meaning?: string;
  notes?: string | null;
  tags?: string[];
  jlptLevel?: number | null;
  priority?: number;
}

export interface StudyProgress {
  id: string;
  wordId: string;
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
  cardState: number; // 0=New, 1=Learning, 2=Review, 3=Relearning
}

export interface WordWithProgress extends Word {
  progress: StudyProgress | null;
}

export interface ExportDataV1 {
  version: 1;
  exportedAt: string;
  words: Word[];
  studyProgress: StudyProgress[];
}

export interface WordbookExportItem {
  wordbookId: string;
  wordId: string;
  addedAt: string;
}

export interface UserWordStateExport {
  wordId: string;
  mastered: boolean;
  masteredAt: string | null;
  priority: number;
}

export interface ExportDataV2 {
  version: 2;
  exportedAt: string;
  words: Word[];
  studyProgress: StudyProgress[];
  wordbooks: { id: string; name: string; description: string | null; createdAt: string; updatedAt: string }[];
  wordbookItems: WordbookExportItem[];
}

export interface ExportData {
  version: 3;
  exportedAt: string;
  words: Word[];
  studyProgress: StudyProgress[];
  wordbooks: { id: string; name: string; description: string | null; createdAt: string; updatedAt: string }[];
  wordbookItems: WordbookExportItem[];
  userWordState: UserWordStateExport[];
}

export type ImportData = ExportData | ExportDataV2 | ExportDataV1;

export interface DictionaryEntry {
  slug: string;
  japanese: {
    word?: string;
    reading: string;
  }[];
  senses: {
    englishDefinitions: string[];
    partsOfSpeech: string[];
  }[];
  jlptLevels: string[];
}
