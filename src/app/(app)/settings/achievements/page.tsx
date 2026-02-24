'use client';

import { useState } from 'react';
import { Trophy, Star, Flame, BookCheck } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Header } from '@/components/layout/header';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import type { AchievementType, Achievement } from '@/types/quiz';

const ACHIEVEMENT_DEFS: {
  type: AchievementType;
  icon: typeof Trophy;
  colorClass: string;
  labelKey: keyof typeof import('@/lib/i18n/en').default.achievements;
}[] = [
  { type: 'first_quiz', icon: Star, colorClass: 'text-yellow-500', labelKey: 'firstQuiz' },
  { type: 'words_100', icon: BookCheck, colorClass: 'text-blue-500', labelKey: 'words100' },
  { type: 'words_500', icon: BookCheck, colorClass: 'text-purple-500', labelKey: 'words500' },
  { type: 'words_1000', icon: BookCheck, colorClass: 'text-pink-500', labelKey: 'words1000' },
  { type: 'streak_7', icon: Flame, colorClass: 'text-orange-500', labelKey: 'streak7' },
  { type: 'streak_30', icon: Flame, colorClass: 'text-red-500', labelKey: 'streak30' },
];

export default function AchievementsPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const [achievements, setAchievements] = useState<Achievement[]>([]);

  const [loading] = useLoader(async () => {
    const data = await repo.study.getAchievements();
    setAchievements(data);
  }, [repo]);

  const unlockedTypes = new Set(achievements.map((a) => a.type));
  const unlockedMap = new Map(achievements.map((a) => [a.type, a]));

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
          <div className="space-y-3">
            {ACHIEVEMENT_DEFS.map((def, i) => {
              const isUnlocked = unlockedTypes.has(def.type);
              const achievement = unlockedMap.get(def.type);
              const Icon = def.icon;

              return (
                <div
                  key={def.type}
                  className="animate-stagger flex items-center gap-4 rounded-lg border p-4"
                  style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
                >
                  <div className={`shrink-0 ${isUnlocked ? def.colorClass : 'text-muted-foreground/30'}`}>
                    <Icon className="size-8" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`font-medium ${isUnlocked ? '' : 'text-muted-foreground'}`}>
                      {t.achievements[def.labelKey]}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {isUnlocked && achievement
                        ? `${t.achievements.unlocked} · ${achievement.unlockedAt.toLocaleDateString()}`
                        : t.achievements.locked}
                    </div>
                  </div>
                  {isUnlocked && (
                    <Trophy className="size-5 shrink-0 text-yellow-500" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
