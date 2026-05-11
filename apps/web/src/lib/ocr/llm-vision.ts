export interface ExtractedWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number | null;
  dictionaryEntryId?: string | null;
}
