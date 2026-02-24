'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BookOpenCheck, Flame } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Header } from '@/components/layout/header';
import { Flashcard } from '@/components/quiz/flashcard';
import { SessionReport } from '@/components/quiz/session-report';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { markWordMastered } from '@/lib/actions/mark-mastered';
import { isNewCard } from '@/lib/spaced-repetition';
import { checkAndUnlockAchievements } from '@/lib/quiz/achievements';
import { requestDueCountRefresh } from '@/lib/quiz/due-count-sync';
import { shuffleArray } from '@/lib/quiz/word-scoring';
import {
  readSession,
  writeSession,
  clearSession,
  cleanupLegacyKeys,
  getLocalDateString,
  type QuizMode,
} from '@/lib/quiz/session-store';
import type { DataRepository } from '@/lib/repository/types';
import type { WordWithProgress } from '@/types/word';
import type { CardDirection } from '@/types/quiz';

/**
 * Try restoring a saved quiz session from localStorage.
 * Returns null if no session found or all words have been mastered.
 */
async function tryRestoreSession(
  mode: QuizMode,
  repo: DataRepository,
): Promise<{
  words: WordWithProgress[];
  index: number;
  completed: number;
  stats: { totalReviewed: number; newCards: number; againCount: number };
} | null> {
  const saved = readSession(mode);
  if (!saved) return null;

  const allWords = await repo.words.getByIds(saved.wordIds);
  const words = allWords.filter((w) => !w.mastered);

  if (words.length === 0) {
    clearSession(mode);
    return null;
  }

  const progressMap = await repo.study.getProgressByIds(words.map((w) => w.id));
  const withProgress: WordWithProgress[] = words.map((w) => ({
    ...w,
    progress: progressMap.get(w.id) ?? null,
  }));

  const currentWordId = saved.wordIds[saved.currentIndex];
  const restoredIndex = currentWordId
    ? withProgress.findIndex((w) => w.id === currentWordId)
    : -1;

  return {
    words: withProgress,
    index: restoredIndex >= 0 ? restoredIndex : Math.min(saved.currentIndex, withProgress.length - 1),
    completed: saved.completed,
    stats: saved.sessionStats,
  };
}

export default function QuizPage() {
  return (
    <Suspense>
      <QuizContent />
    </Suspense>
  );
}

function QuizContent() {
  const router = useRouter();
  const repo = useRepository();
  const authLoading = useAuthStore((s) => s.loading);
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const quickStart = searchParams.get('quickStart') === '1';
  const quizMode: QuizMode = quickStart ? 'quickstart' : 'general';

  const [dueWords, setDueWords] = useState<WordWithProgress[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [streak, setStreak] = useState<number | null>(null);
  const [showReport, setShowReport] = useState(false);

  const [cardDirection, setCardDirection] = useState<CardDirection>('term_first');
  const [sessionStats, setSessionStats] = useState({
    totalReviewed: 0,
    newCards: 0,
    againCount: 0,
  });

  const [loading, reload] = useLoader(async () => {
    cleanupLegacyKeys();

    const restored = await tryRestoreSession(quizMode, repo);
    if (restored) {
      setDueWords(restored.words);
      setCurrentIndex(restored.index);
      setCompleted(restored.completed);
      setSessionStats(restored.stats);
      return;
    }

    const settings = await repo.study.getQuizSettings();
    setCardDirection(settings.cardDirection);

    if (quickStart) {
      const [todayStats, all] = await Promise.all([
        repo.study.getDailyStats(getLocalDateString()),
        repo.words.getNonMastered(),
      ]);
      const remaining = Math.max(0, settings.newPerDay - (todayStats?.newCount ?? 0));
      const take = Math.min(remaining, all.length);
      const shuffled = [...all];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const selected = shuffled.slice(0, take);
      const progressMap = await repo.study.getProgressByIds(selected.map((w) => w.id));
      const withProgress: WordWithProgress[] = selected.map((w) => ({
        ...w,
        progress: progressMap.get(w.id) ?? null,
      }));
      setDueWords(withProgress);
      setCurrentIndex(0);
      setCompleted(0);
      setSessionStats({ totalReviewed: 0, newCards: 0, againCount: 0 });
    } else {
      const words = await repo.study.getDueWords(20);
      setDueWords(shuffleArray([...words]));
      setCurrentIndex(0);
      setCompleted(0);
      setSessionStats({ totalReviewed: 0, newCards: 0, againCount: 0 });
    }
  }, [repo, quickStart], { skip: authLoading });

  useEffect(() => {
    if (authLoading) return;

    let cancelled = false;

    repo.study
      .getStreakDays()
      .then((days) => {
        if (!cancelled) setStreak(days);
      })
      .catch(() => {
        if (!cancelled) setStreak(0);
      });

    return () => {
      cancelled = true;
    };
  }, [repo, authLoading]);

  useEffect(() => {
    return () => {
      requestDueCountRefresh();
    };
  }, []);

  // Persist session on every meaningful state change
  useEffect(() => {
    if (loading) return;
    if (showReport || dueWords.length === 0) {
      clearSession(quizMode);
      return;
    }
    writeSession({
      version: 1,
      mode: quizMode,
      date: getLocalDateString(),
      updatedAt: Date.now(),
      wordIds: dueWords.map((w) => w.id),
      currentIndex,
      completed,
      sessionStats,
    });
  }, [loading, showReport, dueWords, currentIndex, completed, sessionStats, quizMode]);

  // --- SRS handlers ---

  const advanceToNext = async () => {
    if (currentIndex + 1 < dueWords.length) {
      setCurrentIndex((i) => i + 1);
    } else {
      if (sessionStats.totalReviewed > 0 || completed > 0) {
        setShowReport(true);
        try {
          const newAchievements = await checkAndUnlockAchievements(repo);
          for (const type of newAchievements) {
            const achievementNames: Record<string, string> = {
              first_quiz: t.achievements.firstQuiz,
              words_100: t.achievements.words100,
              words_500: t.achievements.words500,
              words_1000: t.achievements.words1000,
              streak_7: t.achievements.streak7,
              streak_30: t.achievements.streak30,
            };
            toast.success(`${achievementNames[type] ?? type}`);
          }
        } catch {
          // Achievement check is non-critical
        }
        const newStreak = await repo.study.getStreakDays();
        setStreak(newStreak);
      } else {
        await reload();
      }
    }
  };

  const handleRate = async (quality: number) => {
    const currentWord = dueWords[currentIndex];
    const wasNew = isNewCard(currentWord.progress);
    try {
      await repo.study.recordReview(currentWord.id, quality);

      setSessionStats((prev) => ({
        totalReviewed: prev.totalReviewed + 1,
        newCards: prev.newCards + (wasNew ? 1 : 0),
        againCount: prev.againCount + (quality === 0 ? 1 : 0),
      }));
      requestDueCountRefresh();
      setCompleted((c) => c + 1);
      await advanceToNext();
    } catch (error) {
      console.error('Failed to record review', error);
    }
  };

  const handleMaster = async () => {
    const currentWord = dueWords[currentIndex];
    await markWordMastered(repo, currentWord.id);
    const remaining = dueWords.filter((_, i) => i !== currentIndex);
    setCompleted((c) => c + 1);

    if (remaining.length === 0) {
      setDueWords(remaining);
      if (sessionStats.totalReviewed > 0 || completed > 0) {
        setShowReport(true);
        const newStreak = await repo.study.getStreakDays();
        setStreak(newStreak);
      }
      return;
    }

    const nextIndex = currentIndex >= remaining.length ? 0 : currentIndex;
    setDueWords(remaining);
    setCurrentIndex(nextIndex);
  };

  const handleContinueStudying = async () => {
    clearSession(quizMode);
    if (quickStart) {
      // Switch to general SRS quiz instead of re-rolling another random batch
      router.push('/quiz');
      return;
    }
    setShowReport(false);
    setSessionStats({ totalReviewed: 0, newCards: 0, againCount: 0 });
    await reload();
  };

  const handleBackToHome = () => {
    router.push('/words');
  };

  // --- Render ---

  const currentSrsWord = dueWords[currentIndex];
  const progressCount = !loading && dueWords.length > 0
    ? `${currentIndex + 1}/${dueWords.length}`
    : undefined;
  const headerStatsLoading = loading || streak === null;

  if (showReport && sessionStats.totalReviewed > 0) {
    return (
      <>
        <Header title={t.quiz.sessionComplete} />
        <SessionReport
          totalReviewed={sessionStats.totalReviewed}
          newCards={sessionStats.newCards}
          againCount={sessionStats.againCount}
          streak={streak ?? 0}
          onContinue={handleContinueStudying}
          onHome={handleBackToHome}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title={t.quiz.title}
        actions={
          <div className="flex items-center gap-1.5">
            {headerStatsLoading ? (
              <>
                <Skeleton className="h-7 w-11 rounded-full" />
                <Skeleton className="h-7 w-16 rounded-full" />
              </>
            ) : (
              <>
                {(streak ?? 0) > 0 && (
                  <span className="inline-flex h-7 items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 text-xs font-semibold text-orange-400">
                    <Flame className="size-3.5" />
                    <span className="tabular-nums">{streak}</span>
                  </span>
                )}
                {progressCount && (
                  <span className="inline-flex h-7 items-center rounded-full border border-border/60 bg-muted/30 px-2.5 text-xs">
                    <span className="tabular-nums font-medium text-foreground/90">{progressCount}</span>
                  </span>
                )}
              </>
            )}
          </div>
        }
      />
      {!loading && dueWords.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <BookOpenCheck className="animate-scale-in size-10 text-primary" />
          <div className="animate-slide-up mt-4 text-lg font-semibold" style={{ animationDelay: '100ms' }}>{t.quiz.allCaughtUp}</div>
          <div className="animate-slide-up mt-2 text-muted-foreground" style={{ animationDelay: '200ms' }}>
            {t.quiz.noWordsDue}
          </div>
          <div className="animate-slide-up mt-1 text-muted-foreground" style={{ animationDelay: '300ms' }}>
            {t.quiz.noWordsDueHint}
          </div>
          {completed > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              {t.quiz.reviewed(completed)}
            </div>
          )}
        </div>
      ) : (
        <Flashcard
          key={currentSrsWord?.id ?? 'srs-loading'}
          word={currentSrsWord}
          onRate={handleRate}
          onMaster={handleMaster}
          progress={{ current: currentIndex + 1, total: dueWords.length }}
          isLoading={loading}
          cardDirection={cardDirection}
        />
      )}
    </>
  );
}
