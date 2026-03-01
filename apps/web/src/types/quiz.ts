export type CardDirection = 'term_first' | 'meaning_first' | 'random';

export interface QuizSettings {
  newPerDay: number;
  maxReviewsPerDay: number;
  jlptFilter: number | null;
  priorityFilter: number | null;
  cardDirection: CardDirection;
  sessionSize: number;
  leechThreshold: number;
  notificationEnabled: boolean;
  notificationHour: number;   // 0-23
  notificationMinute: number; // 0-59
}

export interface DailyStats {
  id: string;
  date: string; // YYYY-MM-DD
  newCount: number;
  reviewCount: number;
  againCount: number;
  reviewAgainCount: number;
  newAgainCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  masteredInSessionCount: number;
  practiceCount: number;
  practiceKnownCount: number;
}

/** Weighted accuracy weights per rating (0–100 scale) */
export const ACCURACY_WEIGHTS: Record<number, number> = {
  0: 0,   // Again
  1: 20,  // Hard
  2: 50,  // Good
  3: 80,  // Easy
};
export const MASTERED_ACCURACY_WEIGHT = 100;

/** Compute weighted accuracy from daily stats fields */
export function computeWeightedAccuracy(stats: {
  againCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  masteredInSessionCount: number;
}): number {
  const total =
    stats.againCount + stats.hardCount + stats.goodCount +
    stats.easyCount + stats.masteredInSessionCount;
  if (total === 0) return 100;
  const weighted =
    stats.againCount * ACCURACY_WEIGHTS[0] +
    stats.hardCount * ACCURACY_WEIGHTS[1] +
    stats.goodCount * ACCURACY_WEIGHTS[2] +
    stats.easyCount * ACCURACY_WEIGHTS[3] +
    stats.masteredInSessionCount * MASTERED_ACCURACY_WEIGHT;
  return Math.round(weighted / total);
}

export type AchievementType =
  | 'first_quiz'
  | 'words_50'
  | 'words_100'
  | 'words_250'
  | 'words_500'
  | 'words_1000'
  | 'words_2000'
  | 'words_5000'
  | 'streak_3'
  | 'streak_7'
  | 'streak_14'
  | 'streak_30'
  | 'streak_60'
  | 'streak_100'
  | 'streak_365'
  | 'reviews_500'
  | 'reviews_1000'
  | 'reviews_5000'
  | 'perfect_session'
  | 'accuracy_week_80'
  | 'daily_50'
  | 'daily_100';

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
  notificationEnabled: false,
  notificationHour: 9,
  notificationMinute: 0,
};
