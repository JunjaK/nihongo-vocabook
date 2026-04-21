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

    // Accuracy week 80 — at least 3 active days in the past 7, all >= 80%
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
        const active = stats.filter((s) => (s.reviewCount ?? 0) > 0);
        if (active.length < 3) return false;
        return active.every((s) => computeWeightedAccuracy(s) >= 80);
      },
    },

    // Daily goal streak — consecutive days hitting the daily goal
    {
      type: 'daily_goal_streak_7',
      condition: async () => (await countDailyGoalStreak(repo)) >= 7,
    },
    {
      type: 'daily_goal_streak_30',
      condition: async () => (await countDailyGoalStreak(repo)) >= 30,
    },
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

/**
 * Count consecutive days (ending today or yesterday) where the user completed
 * at least `dailyGoal` cards.
 */
async function countDailyGoalStreak(repo: DataRepository): Promise<number> {
  const settings = await repo.study.getQuizSettings();
  const goal = settings.dailyGoal;
  if (goal <= 0) return 0;

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 100);
  const stats = await repo.study.getDailyStatsRange(
    getLocalDateString(start),
    getLocalDateString(today),
  );
  const byDate = new Map(stats.map((s) => [s.date, s]));

  let streak = 0;
  const cursor = new Date(today);
  // Allow today OR yesterday as the anchor — today may not yet be complete
  const todayStats = byDate.get(getLocalDateString(cursor));
  const todayCount = (todayStats?.reviewCount ?? 0) + (todayStats?.masteredInSessionCount ?? 0);
  if (todayCount < goal) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (true) {
    const key = getLocalDateString(cursor);
    const s = byDate.get(key);
    const count = (s?.reviewCount ?? 0) + (s?.masteredInSessionCount ?? 0);
    if (count >= goal) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}
