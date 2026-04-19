export type KanjiReadingType = 'on' | 'kun';

export interface KanjiReading {
  type: KanjiReadingType;
  reading: string;
  meanings: string[];
  meaningsKo?: string[];
}

export interface Kanji {
  character: string;
  strokeCount: number | null;
  jlptLevel: number | null;
  grade: number | null;
  frequency: number | null;
  readings: KanjiReading[];
}
