'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BookOpenCheck, Flame, LogIn, Shuffle } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/layout/header';
import { Flashcard } from '@/components/quiz/flashcard';
import { ExampleQuizCard } from '@/components/quiz/example-quiz-card';
import { SessionReport } from '@/components/quiz/session-report';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { useWakeLock } from '@/hooks/use-wake-lock';
import { markWordMastered } from '@/lib/actions/mark-mastered';
import { isNewCard } from '@/lib/spaced-repetition';
import { requestDueCountRefresh } from '@/lib/quiz/due-count-sync';
import { bottomBar, bottomSep } from '@/lib/styles';
import { buildSessionCards } from '@/lib/quiz/card-selector';
import { buildExampleCard } from '@/lib/quiz/example-quiz';
import {
  readSession,
  writeSession,
  clearSession,
  cleanupLegacyKeys,
  getLocalDateString,
} from '@/lib/quiz/session-store';
import type { QuizCard, CardDirection, QuizSettings } from '@/types/quiz';
import type { WordWithProgress, Word } from '@/types/word';
import type { DataRepository } from '@/lib/repository/types';

type SessionStats = {
  totalReviewed: number;
  newCards: number;
  againCount: number;
  reviewAgainCount: number;
  newAgainCount: number;
  hardCount: number;
  goodCount: number;
  easyCount: number;
  masteredCount: number;
};

const EMPTY_STATS: SessionStats = {
  totalReviewed: 0,
  newCards: 0,
  againCount: 0,
  reviewAgainCount: 0,
  newAgainCount: 0,
  hardCount: 0,
  goodCount: 0,
  easyCount: 0,
  masteredCount: 0,
};

/**
 * Count cards already completed today from daily stats.
 * Used to compute remaining slots against dailyGoal.
 */
function countTodayCompleted(stats: { reviewCount: number; masteredInSessionCount: number } | null): number {
  if (!stats) return 0;
  return stats.reviewCount + stats.masteredInSessionCount;
}

/**
 * Assemble QuizCard[] from persisted word IDs and fresh DB lookups.
 * Re-derives card types so we don't persist heavy payloads.
 */
async function reconstructCards(
  wordIds: string[],
  repo: DataRepository,
  settings: QuizSettings,
): Promise<QuizCard[]> {
  if (wordIds.length === 0) return [];
  const words = await repo.words.getByIds(wordIds);
  const idToWord = new Map(words.map((w) => [w.id, w]));
  const ordered = wordIds.map((id) => idToWord.get(id)).filter((w): w is Word => Boolean(w));
  const nonMastered = ordered.filter((w) => !w.mastered);
  if (nonMastered.length === 0) return [];

  const [progressMap, examplesMap, allUserWords] = await Promise.all([
    repo.study.getProgressByIds(nonMastered.map((w) => w.id)),
    repo.words.getExamplesForWords(nonMastered.map((w) => w.id)),
    repo.words.getAll(),
  ]);

  const withProgress: WordWithProgress[] = nonMastered.map((w) => ({
    ...w,
    progress: progressMap.get(w.id) ?? null,
  }));

  const cards: QuizCard[] = [];
  for (const word of withProgress) {
    const rolled = Math.random() * 100 < settings.exampleQuizRatio;
    const examples = examplesMap.get(word.id) ?? [];
    if (rolled && examples.length > 0 && allUserWords.length >= 3) {
      const card = buildExampleCard(word, examples, allUserWords);
      if (card) {
        cards.push(card);
        continue;
      }
    }
    cards.push({ kind: 'word', word });
  }
  return cards;
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
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const { t } = useTranslation();

  useWakeLock(!authLoading && !!user);

  const [cards, setCards] = useState<QuizCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [totalSessionSize, setTotalSessionSize] = useState(0);
  const [streak, setStreak] = useState<number | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [dailyComplete, setDailyComplete] = useState(false);
  const [cardDirection, setCardDirection] = useState<CardDirection>('term_first');
  const [sessionStats, setSessionStats] = useState<SessionStats>({ ...EMPTY_STATS });

  const [loading] = useLoader(async () => {
    cleanupLegacyKeys();

    const settings = await repo.study.getQuizSettings();
    setCardDirection(settings.cardDirection);

    const todayStats = await repo.study.getDailyStats(getLocalDateString());
    const todayDone = countTodayCompleted(todayStats);
    const remaining = Math.max(0, settings.dailyGoal - todayDone);

    // Try restoring saved session first (date-rolled-sessions auto-clear inside readSession)
    const saved = readSession();
    if (saved) {
      const reconstructed = await reconstructCards(saved.wordIds, repo, settings);
      const remainingCards = reconstructed.slice(saved.currentIndex);
      if (remainingCards.length > 0) {
        setCards(reconstructed);
        setCurrentIndex(saved.currentIndex);
        setCompleted(saved.completed);
        setTotalSessionSize(saved.wordIds.length);
        setSessionStats(saved.sessionStats);
        setDailyComplete(false);
        return;
      }
      // All persisted cards done — fall through to fresh check
      clearSession();
    }

    if (remaining <= 0) {
      setCards([]);
      setCurrentIndex(0);
      setCompleted(0);
      setTotalSessionSize(0);
      setSessionStats({ ...EMPTY_STATS });
      setDailyComplete(true);
      return;
    }

    // Fresh session — fetch candidates, examples, and build cards
    const [candidates, allUserWords] = await Promise.all([
      repo.study.getDueWords(remaining * 3), // overfetch to let selector rank
      repo.words.getAll(),
    ]);

    const examplesMap = await repo.words.getExamplesForWords(candidates.map((w) => w.id));

    const built = buildSessionCards({
      settings,
      candidates,
      examplesByWordId: examplesMap,
      distractorPool: allUserWords,
      remainingSlots: remaining,
    });

    setCards(built);
    setCurrentIndex(0);
    setCompleted(0);
    setTotalSessionSize(built.length);
    setSessionStats({ ...EMPTY_STATS });
    setDailyComplete(built.length === 0);
  }, [repo], { skip: authLoading || !user });

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

  // Persist session on meaningful changes
  useEffect(() => {
    if (loading) return;
    if (showReport || dailyComplete || cards.length === 0) {
      clearSession();
      return;
    }
    writeSession({
      version: 3,
      date: getLocalDateString(),
      updatedAt: Date.now(),
      wordIds: cards.map((c) => c.word.id),
      currentIndex,
      completed,
      sessionStats,
    });
  }, [loading, showReport, dailyComplete, cards, currentIndex, completed, sessionStats]);

  const isProcessingRef = useRef(false);

  const endSession = async () => {
    setShowReport(true);
    const newStreak = await repo.study.getStreakDays();
    setStreak(newStreak);
    requestDueCountRefresh();
  };

  const advanceToNext = async () => {
    if (currentIndex + 1 < cards.length) {
      setCurrentIndex((i) => i + 1);
    } else {
      await endSession();
    }
  };

  /**
   * Apply rating to the current word's FSRS state + session stats.
   * Shared by word-card ratings and example-card answers.
   */
  const recordCardRating = async (card: QuizCard, quality: number) => {
    const wasNew = isNewCard(card.word.progress);
    await repo.study.recordReview(card.word.id, quality);

    const isAgain = quality === 0;
    setSessionStats((prev) => ({
      ...prev,
      totalReviewed: prev.totalReviewed + 1,
      newCards: prev.newCards + (wasNew ? 1 : 0),
      againCount: prev.againCount + (isAgain ? 1 : 0),
      reviewAgainCount: prev.reviewAgainCount + (!wasNew && isAgain ? 1 : 0),
      newAgainCount: prev.newAgainCount + (wasNew && isAgain ? 1 : 0),
      hardCount: prev.hardCount + (quality === 3 ? 1 : 0),
      goodCount: prev.goodCount + (quality === 4 ? 1 : 0),
      easyCount: prev.easyCount + (quality === 5 ? 1 : 0),
    }));
    requestDueCountRefresh();
    setCompleted((c) => c + 1);
  };

  const handleWordRate = async (quality: number) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    try {
      const current = cards[currentIndex];
      if (!current) return;
      await recordCardRating(current, quality);
      await advanceToNext();
    } catch (error) {
      console.error('Failed to record review', error);
    } finally {
      isProcessingRef.current = false;
    }
  };

  const handleExampleAnswer = (correct: boolean) => {
    // Only records stats; advance is triggered by the card after reveal
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    const current = cards[currentIndex];
    if (!current) {
      isProcessingRef.current = false;
      return;
    }
    recordCardRating(current, correct ? 4 : 0)
      .catch((error) => console.error('Failed to record review', error))
      .finally(() => {
        isProcessingRef.current = false;
      });
  };

  const handleMaster = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    try {
      const current = cards[currentIndex];
      if (!current) return;
      await markWordMastered(repo, current.word.id);
      setSessionStats((prev) => ({ ...prev, masteredCount: prev.masteredCount + 1 }));
      await repo.study.incrementMasteredStats(getLocalDateString());

      // Remove card from array
      const remaining = cards.filter((_, i) => i !== currentIndex);
      setCompleted((c) => c + 1);

      if (remaining.length === 0 || currentIndex >= remaining.length) {
        setCards(remaining);
        await endSession();
        return;
      }
      setCards(remaining);
    } catch (error) {
      console.error('Failed to mark word as mastered', error);
      toast.error(t.common.error);
    } finally {
      isProcessingRef.current = false;
    }
  };

  const handleContinueStudying = () => {
    // After a session ends, "continue" routes to random practice (no FSRS impact)
    router.push('/words/random-practice');
  };

  const handleBackToHome = () => {
    router.push('/words');
  };

  // --- Render ---

  if (!authLoading && !user) {
    return (
      <>
        <Header title={t.quiz.title} showBack />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <LogIn className="animate-scale-in size-10 text-primary dark:text-accent-muted" />
          <div className="animate-slide-up mt-4 text-lg font-semibold" style={{ animationDelay: '100ms' }}>
            {t.quiz.loginRequired}
          </div>
          <div className="animate-slide-up mt-2 text-muted-foreground" style={{ animationDelay: '200ms' }}>
            {t.quiz.loginRequiredDescription}
          </div>
        </div>
        <div className={bottomBar}>
          <div className={bottomSep} />
          <div className="flex gap-3">
            <Link href="/login" className="flex-1">
              <Button className="w-full">{t.auth.signIn}</Button>
            </Link>
            <Link href="/signup" className="flex-1">
              <Button variant="secondary" className="w-full">{t.auth.signUp}</Button>
            </Link>
          </div>
        </div>
      </>
    );
  }

  const current = cards[currentIndex];
  const progressCount = !loading && totalSessionSize > 0 && cards.length > 0
    ? `${Math.min(completed + 1, totalSessionSize)} / ${totalSessionSize}`
    : undefined;
  const headerStatsLoading = loading || streak === null;

  if (showReport) {
    return (
      <>
        <Header title={t.quiz.sessionComplete} />
        <SessionReport
          stats={sessionStats}
          streak={streak ?? 0}
          onContinue={handleContinueStudying}
          onHome={handleBackToHome}
        />
      </>
    );
  }

  if (!loading && dailyComplete) {
    return (
      <>
        <Header title={t.quiz.title} />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <BookOpenCheck className="animate-scale-in size-10 text-primary dark:text-accent-muted" />
          <div className="animate-slide-up mt-4 text-lg font-semibold" style={{ animationDelay: '100ms' }}>
            {t.quiz.dailyGoalReached}
          </div>
          <div className="animate-slide-up mt-2 text-muted-foreground" style={{ animationDelay: '200ms' }}>
            {t.quiz.dailyGoalReachedDesc}
          </div>
          {(streak ?? 0) > 0 && (
            <div
              className="animate-slide-up mt-4 inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-sm font-semibold text-orange-400"
              style={{ animationDelay: '300ms' }}
            >
              <Flame className="size-4" />
              {t.quiz.streakDays(streak ?? 0)}
            </div>
          )}
        </div>
        <div className={bottomBar}>
          <div className={bottomSep} />
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleBackToHome}
            >
              {t.quiz.backToHome}
            </Button>
            <Button
              className="flex-1"
              onClick={handleContinueStudying}
            >
              <Shuffle className="mr-1 size-4" />
              {t.quiz.randomPractice}
            </Button>
          </div>
        </div>
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
                  <span className="inline-flex h-7 items-center rounded-full bg-secondary px-3 text-xs font-semibold tabular-nums text-primary dark:text-accent-muted">
                    {progressCount}
                  </span>
                )}
              </>
            )}
          </div>
        }
      />
      {!loading && cards.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <BookOpenCheck className="animate-scale-in size-10 text-primary dark:text-accent-muted" />
          <div className="animate-slide-up mt-4 text-lg font-semibold" style={{ animationDelay: '100ms' }}>{t.quiz.allCaughtUp}</div>
          <div className="animate-slide-up mt-2 text-muted-foreground" style={{ animationDelay: '200ms' }}>
            {t.quiz.noWordsDue}
          </div>
          <div className="animate-slide-up mt-1 text-muted-foreground" style={{ animationDelay: '300ms' }}>
            {t.quiz.noWordsDueHint}
          </div>
        </div>
      ) : current?.kind === 'example' ? (
        <ExampleQuizCard
          key={`${current.word.id}-${current.example.id}`}
          card={current}
          onAnswer={handleExampleAnswer}
          onAdvance={advanceToNext}
          progress={{ current: completed + 1, total: totalSessionSize }}
          isLoading={loading}
        />
      ) : (
        <Flashcard
          key={current?.word.id ?? 'word-loading'}
          word={current?.word}
          onRate={handleWordRate}
          onMaster={handleMaster}
          progress={{ current: completed + 1, total: totalSessionSize }}
          isLoading={loading}
          cardDirection={cardDirection}
        />
      )}
    </>
  );
}
