export type CardDirection = 'term_first' | 'meaning_first' | 'random';

export interface QuizSettings {
  newPerDay: number;
  maxReviewsPerDay: number;
  jlptFilter: number | null;
  priorityFilter: number | null;
  cardDirection: CardDirection;
  sessionSize: number;
  leechThreshold: number;
}

export interface DailyStats {
  id: string;
  date: string; // YYYY-MM-DD
  newCount: number;
  reviewCount: number;
  againCount: number;
  reviewAgainCount: number;
  newAgainCount: number;
  practiceCount: number;
  practiceKnownCount: number;
}

export type AchievementType =
  | 'first_quiz'
  | 'words_100'
  | 'words_500'
  | 'words_1000'
  | 'streak_7'
  | 'streak_30';

export interface Achievement {
  id: string;
  type: AchievementType;
  unlockedAt: Date;
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  newPerDay: 20,
  maxReviewsPerDay: 100,
  jlptFilter: null,
  priorityFilter: null,
  cardDirection: 'term_first',
  sessionSize: 20,
  leechThreshold: 8,
};
