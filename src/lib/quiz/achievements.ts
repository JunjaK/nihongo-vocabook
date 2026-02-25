import type { DataRepository } from '@/lib/repository/types';
import type { AchievementType } from '@/types/quiz';
import { computeWeightedAccuracy } from '@/types/quiz';
import { getLocalDateString } from '@/lib/quiz/date-utils';

export interface SessionContext {
  weightedAccuracy: number;
  totalReviewed: number;
}

/**
 * Check conditions and unlock any newly earned achievements.
 * Returns array of newly unlocked achievement types.
 */
export async function checkAndUnlockAchievements(
  repo: DataRepository,
  sessionContext?: SessionContext,
): Promise<AchievementType[]> {
  const unlocked: AchievementType[] = [];

  const existing = await repo.study.getAchievements();
  const existingTypes = new Set(existing.map((a) => a.type));

  // Pre-fetch shared data to avoid redundant queries
  const [mastered, streak, totalReviewed, todayStats] = await Promise.all([
    repo.words.getMastered(),
    repo.study.getStreakDays(),
    repo.study.getTotalReviewedAllTime(),
    repo.study.getDailyStats(getLocalDateString()),
  ]);
  const masteredCount = mastered.length;
  const todayReviewCount = todayStats?.reviewCount ?? 0;

  const checks: { type: AchievementType; condition: () => Promise<boolean> }[] = [
    // Special
    { type: 'first_quiz', condition: async () => todayReviewCount > 0 },

    // Milestones (mastered words)
    { type: 'words_50', condition: async () => masteredCount >= 50 },
    { type: 'words_100', condition: async () => masteredCount >= 100 },
    { type: 'words_250', condition: async () => masteredCount >= 250 },
    { type: 'words_500', condition: async () => masteredCount >= 500 },
    { type: 'words_1000', condition: async () => masteredCount >= 1000 },
    { type: 'words_2000', condition: async () => masteredCount >= 2000 },
    { type: 'words_5000', condition: async () => masteredCount >= 5000 },

    // Streak
    { type: 'streak_3', condition: async () => streak >= 3 },
    { type: 'streak_7', condition: async () => streak >= 7 },
    { type: 'streak_14', condition: async () => streak >= 14 },
    { type: 'streak_30', condition: async () => streak >= 30 },
    { type: 'streak_60', condition: async () => streak >= 60 },
    { type: 'streak_100', condition: async () => streak >= 100 },
    { type: 'streak_365', condition: async () => streak >= 365 },

    // Volume (total reviews all-time)
    { type: 'reviews_500', condition: async () => totalReviewed >= 500 },
    { type: 'reviews_1000', condition: async () => totalReviewed >= 1000 },
    { type: 'reviews_5000', condition: async () => totalReviewed >= 5000 },

    // Perfect session
    {
      type: 'perfect_session',
      condition: async () => {
        if (!sessionContext) return false;
        return sessionContext.weightedAccuracy === 100 && sessionContext.totalReviewed >= 10;
      },
    },

    // Accuracy week 80
    {
      type: 'accuracy_week_80',
      condition: async () => {
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - 6);
        const stats = await repo.study.getDailyStatsRange(
          getLocalDateString(startDate),
          getLocalDateString(today),
        );
        if (stats.length < 7) return false;
        return stats.every((s) => {
          const acc = computeWeightedAccuracy(s);
          return acc >= 80;
        });
      },
    },

    // Daily volume
    { type: 'daily_50', condition: async () => todayReviewCount >= 50 },
    { type: 'daily_100', condition: async () => todayReviewCount >= 100 },
  ];

  for (const { type, condition } of checks) {
    if (existingTypes.has(type)) continue;
    const met = await condition();
    if (met) {
      const result = await repo.study.unlockAchievement(type);
      if (result) unlocked.push(type);
    }
  }

  return unlocked;
}
