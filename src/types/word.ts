export interface Word {
  id: string;
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

export interface CreateWordInput {
  term: string;
  reading: string;
  meaning: string;
  notes?: string | null;
  tags?: string[];
  jlptLevel?: number | null;
}

export interface UpdateWordInput {
  term?: string;
  reading?: string;
  meaning?: string;
  notes?: string | null;
  tags?: string[];
  jlptLevel?: number | null;
}

export interface StudyProgress {
  id: string;
  wordId: string;
  nextReview: Date;
  intervalDays: number;
  easeFactor: number;
  reviewCount: number;
  lastReviewedAt: Date | null;
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

export interface ExportData {
  version: 2;
  exportedAt: string;
  words: Word[];
  studyProgress: StudyProgress[];
  wordbooks: { id: string; name: string; description: string | null; createdAt: string; updatedAt: string }[];
  wordbookItems: WordbookExportItem[];
}

export type ImportData = ExportData | ExportDataV1;

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
