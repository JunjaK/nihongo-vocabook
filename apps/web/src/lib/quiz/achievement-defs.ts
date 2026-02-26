import {
  Star,
  BookCheck,
  Flame,
  Target,
  Zap,
  Trophy,
  type LucideIcon,
} from '@/components/ui/icons';
import type { AchievementType } from '@/types/quiz';

export type AchievementCategory = 'special' | 'milestone' | 'streak' | 'volume' | 'accuracy';

export interface AchievementDef {
  type: AchievementType;
  category: AchievementCategory;
  icon: LucideIcon;
  colorClass: string;
  labelKey: string;
  descKey: string;
  threshold?: number; // for progress display
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  // Special
  { type: 'first_quiz', category: 'special', icon: Star, colorClass: 'text-yellow-500', labelKey: 'firstQuiz', descKey: 'firstQuizDesc' },

  // Milestone (mastered words)
  { type: 'words_50', category: 'milestone', icon: BookCheck, colorClass: 'text-emerald-500', labelKey: 'words50', descKey: 'words50Desc', threshold: 50 },
  { type: 'words_100', category: 'milestone', icon: BookCheck, colorClass: 'text-blue-500', labelKey: 'words100', descKey: 'words100Desc', threshold: 100 },
  { type: 'words_250', category: 'milestone', icon: BookCheck, colorClass: 'text-indigo-500', labelKey: 'words250', descKey: 'words250Desc', threshold: 250 },
  { type: 'words_500', category: 'milestone', icon: BookCheck, colorClass: 'text-purple-500', labelKey: 'words500', descKey: 'words500Desc', threshold: 500 },
  { type: 'words_1000', category: 'milestone', icon: BookCheck, colorClass: 'text-pink-500', labelKey: 'words1000', descKey: 'words1000Desc', threshold: 1000 },
  { type: 'words_2000', category: 'milestone', icon: BookCheck, colorClass: 'text-rose-500', labelKey: 'words2000', descKey: 'words2000Desc', threshold: 2000 },
  { type: 'words_5000', category: 'milestone', icon: BookCheck, colorClass: 'text-red-500', labelKey: 'words5000', descKey: 'words5000Desc', threshold: 5000 },

  // Streak
  { type: 'streak_3', category: 'streak', icon: Flame, colorClass: 'text-amber-500', labelKey: 'streak3', descKey: 'streak3Desc', threshold: 3 },
  { type: 'streak_7', category: 'streak', icon: Flame, colorClass: 'text-orange-500', labelKey: 'streak7', descKey: 'streak7Desc', threshold: 7 },
  { type: 'streak_14', category: 'streak', icon: Flame, colorClass: 'text-orange-600', labelKey: 'streak14', descKey: 'streak14Desc', threshold: 14 },
  { type: 'streak_30', category: 'streak', icon: Flame, colorClass: 'text-red-500', labelKey: 'streak30', descKey: 'streak30Desc', threshold: 30 },
  { type: 'streak_60', category: 'streak', icon: Flame, colorClass: 'text-red-600', labelKey: 'streak60', descKey: 'streak60Desc', threshold: 60 },
  { type: 'streak_100', category: 'streak', icon: Flame, colorClass: 'text-red-700', labelKey: 'streak100', descKey: 'streak100Desc', threshold: 100 },
  { type: 'streak_365', category: 'streak', icon: Flame, colorClass: 'text-red-800', labelKey: 'streak365', descKey: 'streak365Desc', threshold: 365 },

  // Volume (total reviews)
  { type: 'reviews_500', category: 'volume', icon: Zap, colorClass: 'text-cyan-500', labelKey: 'reviews500', descKey: 'reviews500Desc', threshold: 500 },
  { type: 'reviews_1000', category: 'volume', icon: Zap, colorClass: 'text-teal-500', labelKey: 'reviews1000', descKey: 'reviews1000Desc', threshold: 1000 },
  { type: 'reviews_5000', category: 'volume', icon: Zap, colorClass: 'text-green-500', labelKey: 'reviews5000', descKey: 'reviews5000Desc', threshold: 5000 },

  // Accuracy
  { type: 'perfect_session', category: 'accuracy', icon: Target, colorClass: 'text-yellow-500', labelKey: 'perfectSession', descKey: 'perfectSessionDesc' },
  { type: 'accuracy_week_80', category: 'accuracy', icon: Target, colorClass: 'text-green-500', labelKey: 'accuracyWeek80', descKey: 'accuracyWeek80Desc' },

  // Daily volume
  { type: 'daily_50', category: 'volume', icon: Trophy, colorClass: 'text-violet-500', labelKey: 'daily50', descKey: 'daily50Desc', threshold: 50 },
  { type: 'daily_100', category: 'volume', icon: Trophy, colorClass: 'text-fuchsia-500', labelKey: 'daily100', descKey: 'daily100Desc', threshold: 100 },
];

export const CATEGORY_ORDER: AchievementCategory[] = ['special', 'milestone', 'streak', 'volume', 'accuracy'];

export function getDefsByCategory(): Map<AchievementCategory, AchievementDef[]> {
  const map = new Map<AchievementCategory, AchievementDef[]>();
  for (const cat of CATEGORY_ORDER) {
    map.set(cat, ACHIEVEMENT_DEFS.filter((d) => d.category === cat));
  }
  return map;
}
