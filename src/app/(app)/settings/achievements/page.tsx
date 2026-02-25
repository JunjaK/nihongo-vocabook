'use client';

import { useState } from 'react';
import { Trophy } from '@/components/ui/icons';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Header } from '@/components/layout/header';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import {
  ACHIEVEMENT_DEFS,
  CATEGORY_ORDER,
  getDefsByCategory,
  type AchievementCategory,
} from '@/lib/quiz/achievement-defs';
import type { Achievement } from '@/types/quiz';

interface ProgressData {
  masteredCount: number;
  streak: number;
  totalReviewed: number;
  todayReviewed: number;
}

export default function AchievementsPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [progress, setProgress] = useState<ProgressData>({
    masteredCount: 0,
    streak: 0,
    totalReviewed: 0,
    todayReviewed: 0,
  });

  const [loading] = useLoader(async () => {
    const [data, mastered, streak, totalReviewed, todayStats] = await Promise.all([
      repo.study.getAchievements(),
      repo.words.getMastered(),
      repo.study.getStreakDays(),
      repo.study.getTotalReviewedAllTime(),
      repo.study.getDailyStats(
        new Date().toISOString().slice(0, 10),
      ),
    ]);
    setAchievements(data);
    setProgress({
      masteredCount: mastered.length,
      streak,
      totalReviewed,
      todayReviewed: todayStats?.reviewCount ?? 0,
    });
  }, [repo]);

  const unlockedTypes = new Set(achievements.map((a) => a.type));
  const unlockedMap = new Map(achievements.map((a) => [a.type, a]));
  const defsByCategory = getDefsByCategory();

  const categoryLabels: Record<AchievementCategory, string> = {
    special: t.achievements.categorySpecial,
    milestone: t.achievements.categoryMilestone,
    streak: t.achievements.categoryStreak,
    volume: t.achievements.categoryVolume,
    accuracy: t.achievements.categoryAccuracy,
  };

  function getProgressValue(type: string): number | null {
    if (type.startsWith('words_')) return progress.masteredCount;
    if (type.startsWith('streak_')) return progress.streak;
    if (type.startsWith('reviews_')) return progress.totalReviewed;
    if (type === 'daily_50' || type === 'daily_100') return progress.todayReviewed;
    return null;
  }

  const unlockedCount = achievements.length;
  const totalCount = ACHIEVEMENT_DEFS.length;

  return (
    <>
      <Header title={t.achievements.title} showBack />
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner className="size-8" />
          {t.common.loading}
        </div>
      ) : (
        <div className="animate-page flex-1 overflow-y-auto p-4">
          {/* Summary with progress bar */}
          <div className="mb-5 flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <Trophy className="size-6 text-yellow-500" />
            <span className="font-medium tabular-nums">{unlockedCount} / {totalCount}</span>
            <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-yellow-500 transition-all"
                style={{ width: `${(unlockedCount / totalCount) * 100}%` }}
              />
            </div>
          </div>

          <div className="space-y-6">
            {(() => {
              let runningIndex = 0;
              return CATEGORY_ORDER.map((category) => {
                const defs = defsByCategory.get(category);
                if (!defs || defs.length === 0) return null;

                return (
                  <section key={category}>
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {categoryLabels[category]}
                    </h2>
                    <div className="space-y-2">
                      {defs.map((def) => {
                        const stagger = Math.min(runningIndex++, 15);
                        const isUnlocked = unlockedTypes.has(def.type);
                        const achievement = unlockedMap.get(def.type);
                        const Icon = def.icon;
                        const currentProgress = getProgressValue(def.type);
                        const threshold = def.threshold;
                        const showProgress = !isUnlocked && currentProgress !== null && threshold;

                        const formattedDate = isUnlocked && achievement
                          ? `${achievement.unlockedAt.getFullYear()}.${String(achievement.unlockedAt.getMonth() + 1).padStart(2, '0')}.${String(achievement.unlockedAt.getDate()).padStart(2, '0')}`
                          : '';

                        return (
                          <div
                            key={def.type}
                            className="animate-stagger flex items-center gap-3 rounded-lg border p-3"
                            style={{ '--stagger': stagger } as React.CSSProperties}
                          >
                            <div
                              className={`shrink-0 ${isUnlocked ? def.colorClass : 'text-muted-foreground/40'}`}
                            >
                              <Icon className="size-7" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div
                                className={`text-sm font-medium ${isUnlocked ? '' : 'text-muted-foreground'}`}
                              >
                                {(t.achievements as unknown as Record<string, string>)[def.labelKey]}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {isUnlocked && achievement
                                  ? `${t.achievements.unlocked} · ${formattedDate}`
                                  : (t.achievements as unknown as Record<string, string>)[def.descKey]}
                              </div>
                              {showProgress && (
                                <div className="mt-1.5 flex items-center gap-2">
                                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className="h-full rounded-full bg-primary transition-all"
                                      style={{
                                        width: `${Math.min((currentProgress / threshold) * 100, 100)}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="text-[10px] tabular-nums text-muted-foreground">
                                    {t.achievements.progress(
                                      Math.min(currentProgress, threshold),
                                      threshold,
                                    )}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              });
            })()}
          </div>
        </div>
      )}
    </>
  );
}
