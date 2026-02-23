import type { DataRepository } from '@/lib/repository/types';
import type { AchievementType } from '@/types/quiz';

/**
 * Check conditions and unlock any newly earned achievements.
 * Returns array of newly unlocked achievement types.
 */
export async function checkAndUnlockAchievements(
  repo: DataRepository,
): Promise<AchievementType[]> {
  const unlocked: AchievementType[] = [];

  const existing = await repo.study.getAchievements();
  const existingTypes = new Set(existing.map((a) => a.type));

  const checks: { type: AchievementType; condition: () => Promise<boolean> }[] = [
    {
      type: 'first_quiz',
      condition: async () => {
        const stats = await repo.study.getDailyStats(
          new Date().toISOString().slice(0, 10),
        );
        return (stats?.reviewCount ?? 0) > 0;
      },
    },
    {
      type: 'words_100',
      condition: async () => {
        const mastered = await repo.words.getMastered();
        return mastered.length >= 100;
      },
    },
    {
      type: 'words_500',
      condition: async () => {
        const mastered = await repo.words.getMastered();
        return mastered.length >= 500;
      },
    },
    {
      type: 'words_1000',
      condition: async () => {
        const mastered = await repo.words.getMastered();
        return mastered.length >= 1000;
      },
    },
    {
      type: 'streak_7',
      condition: async () => {
        const streak = await repo.study.getStreakDays();
        return streak >= 7;
      },
    },
    {
      type: 'streak_30',
      condition: async () => {
        const streak = await repo.study.getStreakDays();
        return streak >= 30;
      },
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
