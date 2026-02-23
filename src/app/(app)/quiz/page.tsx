'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { BookOpenCheck, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Header } from '@/components/layout/header';
import { Flashcard } from '@/components/quiz/flashcard';
import { PracticeFlashcard } from '@/components/quiz/practice-flashcard';
import { SessionReport } from '@/components/quiz/session-report';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';
import { isNewCard } from '@/lib/spaced-repetition';
import { selectPracticeWords } from '@/lib/quiz/word-scoring';
import { checkAndUnlockAchievements } from '@/lib/quiz/achievements';
import { requestDueCountRefresh } from '@/lib/quiz/due-count-sync';
import type { Word, WordWithProgress } from '@/types/word';

const SRS_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

type SrsSessionSnapshot = {
  updatedAt: number;
  currentWordId: string | null;
  completed: number;
  sessionStats: {
    totalReviewed: number;
    newCards: number;
    againCount: number;
  };
};

function getSrsSessionKey(wordId: string | null): string {
  return `quiz:srs-session:${wordId ?? 'general'}`;
}

function readSrsSession(key: string): SrsSessionSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SrsSessionSnapshot;
    if (!parsed || typeof parsed.updatedAt !== 'number') return null;
    if (Date.now() - parsed.updatedAt > SRS_SESSION_TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeSrsSession(key: string, snapshot: SrsSessionSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(snapshot));
  } catch {
    // Ignore storage write failure.
  }
}

function clearSrsSession(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage remove failure.
  }
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
  const wordId = searchParams.get('wordId');
  const wordbookId = searchParams.get('wordbookId');
  const quickStart = searchParams.get('quickStart') === '1';
  const restorableSrs = !wordbookId && !quickStart;
  const srsSessionKey = getSrsSessionKey(wordId);

  // SRS mode state
  const [dueWords, setDueWords] = useState<WordWithProgress[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(0);
  const [streak, setStreak] = useState<number | null>(null);
  const [showReport, setShowReport] = useState(false);
  const loadStart = useRef(0);

  // Session tracking (SRS only)
  const [sessionStats, setSessionStats] = useState({
    totalReviewed: 0,
    newCards: 0,
    againCount: 0,
  });

  // Practice mode state (wordbook only)
  const [practiceWords, setPracticeWords] = useState<Word[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceStats, setPracticeStats] = useState({ total: 0, masteredCount: 0 });
  const [practiceComplete, setPracticeComplete] = useState(false);

  const loadDueWords = useCallback(async () => {
    if (authLoading) return;

    setLoading(true);
    loadStart.current = Date.now();

    if (wordId) {
      const word = await repo.words.getById(wordId);
      if (word) {
        const progress = await repo.study.getProgress(wordId);
        const nextDueWords = [{ ...word, progress }];
        setDueWords(nextDueWords);
        const saved = readSrsSession(srsSessionKey);
        setCurrentIndex(0);
        if (saved) {
          setCompleted(saved.completed);
          setSessionStats(saved.sessionStats);
        } else {
          setCompleted(0);
          setSessionStats({ totalReviewed: 0, newCards: 0, againCount: 0 });
        }
      } else {
        setDueWords([]);
        setCurrentIndex(0);
        setCompleted(0);
        setSessionStats({ totalReviewed: 0, newCards: 0, againCount: 0 });
      }
    } else if (wordbookId) {
      // Practice mode — no SRS
      const settings = await repo.study.getQuizSettings();
      const allWords = await repo.wordbooks.getWords(wordbookId);
      const nonMastered = allWords.filter((w) => !w.mastered);
      const selected = selectPracticeWords(nonMastered, settings.newPerDay, settings.jlptFilter);
      setPracticeWords(selected);
      setPracticeIndex(0);
      setPracticeStats({ total: selected.length, masteredCount: 0 });
      setPracticeComplete(false);
      setCurrentIndex(0);
      setCompleted(0);
    } else if (quickStart) {
      const settings = await repo.study.getQuizSettings();
      const all = await repo.words.getNonMastered();
      const take = Math.min(Math.max(settings.newPerDay, 0), all.length);
      const shuffled = [...all];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const selected = shuffled.slice(0, take);
      const withProgress = await Promise.all(
        selected.map(async (w) => ({
          ...w,
          progress: await repo.study.getProgress(w.id),
        })),
      );
      setDueWords(withProgress);
      setCurrentIndex(0);
      setCompleted(0);
      setSessionStats({ totalReviewed: 0, newCards: 0, againCount: 0 });
      clearSrsSession(srsSessionKey);
    } else {
      const words = await repo.study.getDueWords(20);
      setDueWords(words);
      if (restorableSrs) {
        const saved = readSrsSession(srsSessionKey);
        if (saved) {
          const restoredIndex = saved.currentWordId
            ? words.findIndex((w) => w.id === saved.currentWordId)
            : -1;
          setCurrentIndex(restoredIndex >= 0 ? restoredIndex : 0);
          setCompleted(saved.completed);
          setSessionStats(saved.sessionStats);
        } else {
          setCurrentIndex(0);
          setCompleted(0);
          setSessionStats({ totalReviewed: 0, newCards: 0, againCount: 0 });
        }
      } else {
        setCurrentIndex(0);
        setCompleted(0);
        setSessionStats({ totalReviewed: 0, newCards: 0, againCount: 0 });
      }
    }

    const remaining = 300 - (Date.now() - loadStart.current);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    setLoading(false);
  }, [repo, wordId, wordbookId, authLoading, srsSessionKey, quickStart, restorableSrs]);

  useEffect(() => {
    loadDueWords();
  }, [loadDueWords]);

  useEffect(() => {
    if (authLoading || wordbookId) return;

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
  }, [repo, wordbookId, authLoading]);

  useEffect(() => {
    return () => {
      // Keep bottom badge in sync when leaving quiz mid-session.
      requestDueCountRefresh();
    };
  }, []);

  useEffect(() => {
    if (!restorableSrs) return;
    if (loading) return;
    if (showReport || dueWords.length === 0) {
      clearSrsSession(srsSessionKey);
      return;
    }
    const currentWordId = dueWords[currentIndex]?.id ?? null;
    writeSrsSession(srsSessionKey, {
      updatedAt: Date.now(),
      currentWordId,
      completed,
      sessionStats,
    });
  }, [restorableSrs, loading, showReport, dueWords, currentIndex, completed, sessionStats, srsSessionKey]);

  // --- SRS handlers (single word + general quiz) ---

  const advanceToNext = async () => {
    if (currentIndex + 1 < dueWords.length) {
      setCurrentIndex((i) => i + 1);
    } else {
      if (wordId) {
        const word = await repo.words.getById(wordId);
        if (word) {
          const progress = await repo.study.getProgress(wordId);
          setDueWords([{ ...word, progress }]);
          setCurrentIndex(0);
        }
      } else {
        // General quiz — show report if we reviewed any cards
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
          await loadDueWords();
        }
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
      // Prevent unhandled promise errors from breaking the quiz flow.
      console.error('Failed to record review', error);
    }
  };

  const handleMaster = async () => {
    const currentWord = dueWords[currentIndex];
    await repo.words.setMastered(currentWord.id, true);
    invalidateListCache('words');
    invalidateListCache('mastered');
    requestDueCountRefresh();
    setDueWords((prev) => prev.filter((_, i) => i !== currentIndex));
    setCompleted((c) => c + 1);
    if (currentIndex >= dueWords.length - 1) {
      setCurrentIndex(0);
    }
  };

  const handleContinueStudying = async () => {
    setShowReport(false);
    setSessionStats({ totalReviewed: 0, newCards: 0, againCount: 0 });
    clearSrsSession(srsSessionKey);
    await loadDueWords();
  };

  const handleBackToHome = () => {
    router.push('/words');
  };

  // --- Practice mode handlers (wordbook only) ---

  const handlePracticeSetPriority = async (wId: string, priority: number) => {
    try {
      await repo.words.setPriority(wId, priority);
      invalidateListCache('words');
      // Update local state to reflect the new priority
      setPracticeWords((prev) =>
        prev.map((w) => (w.id === wId ? { ...w, priority } : w)),
      );
      // Auto-advance after a short delay
      setTimeout(() => {
        if (practiceIndex + 1 < practiceWords.length) {
          setPracticeIndex((i) => i + 1);
        } else {
          setPracticeComplete(true);
        }
      }, 300);
    } catch (error) {
      // Keep session stable even if save fails for a single card.
      console.error('Failed to update priority', error);
    }
  };

  const handlePracticeMaster = async (wId: string) => {
    await repo.words.setMastered(wId, true);
    invalidateListCache('words');
    invalidateListCache('mastered');
    invalidateListCache('wordbooks');
    requestDueCountRefresh();
    setPracticeStats((prev) => ({ ...prev, masteredCount: prev.masteredCount + 1 }));
    // Remove from session
    const remaining = practiceWords.filter((w) => w.id !== wId);
    setPracticeWords(remaining);
    if (remaining.length === 0) {
      setPracticeComplete(true);
    } else if (practiceIndex >= remaining.length) {
      setPracticeIndex(0);
    }
  };

  const handlePracticeAgain = async () => {
    setPracticeComplete(false);
    await loadDueWords();
  };

  const handleBackToWordbook = () => {
    router.push(`/wordbooks/${wordbookId}`);
  };

  // --- Render ---

  const isPracticeMode = !!wordbookId;
  const currentPracticeWord = practiceWords[practiceIndex];
  const currentSrsWord = dueWords[currentIndex];

  const title = wordId
    ? t.quiz.practice
    : wordbookId
      ? t.quiz.wordbookQuiz
      : t.quiz.title;

  const progressCount = !loading
    ? isPracticeMode
      ? practiceWords.length > 0
        ? `${practiceIndex + 1}/${practiceWords.length}`
        : undefined
      : dueWords.length > 0 && !wordId
        ? `${currentIndex + 1}/${dueWords.length}`
        : undefined
    : undefined;
  const headerStatsLoading = loading || (!isPracticeMode && streak === null);

  // SRS session report (general quiz only)
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

  // Practice completion screen (wordbook only)
  if (isPracticeMode && practiceComplete) {
    return (
      <>
        <Header title={t.quiz.practiceComplete} showBack />
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <BookOpenCheck className="animate-scale-in size-10 text-primary" />
          <div className="animate-slide-up mt-4 text-lg font-semibold" style={{ animationDelay: '100ms' }}>
            {t.quiz.practiceComplete}
          </div>
          <div className="animate-slide-up mt-2 text-muted-foreground" style={{ animationDelay: '200ms' }}>
            {t.quiz.practicedCount(practiceStats.total)}
          </div>
          {practiceStats.masteredCount > 0 && (
            <div className="animate-slide-up mt-1 text-muted-foreground" style={{ animationDelay: '300ms' }}>
              {t.quiz.masteredInSession(practiceStats.masteredCount)}
            </div>
          )}
          <div className="animate-slide-up mt-6 flex gap-3" style={{ animationDelay: '400ms' }}>
            <Button variant="outline" onClick={handlePracticeAgain}>
              {t.quiz.practiceAgain}
            </Button>
            <Button onClick={handleBackToWordbook}>
              {t.quiz.backToWordbook}
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title={title}
        showBack={!!(wordId || wordbookId)}
        actions={
          <div className="flex items-center gap-1.5">
            {headerStatsLoading ? (
              <>
                {!isPracticeMode && <Skeleton className="h-7 w-11 rounded-full" />}
                <Skeleton className="h-7 w-16 rounded-full" />
              </>
            ) : (
              <>
                {!isPracticeMode && (streak ?? 0) > 0 && (
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
      {isPracticeMode ? (
        !loading && practiceWords.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <BookOpenCheck className="animate-scale-in size-10 text-primary" />
            <div className="animate-slide-up mt-4 text-lg font-semibold" style={{ animationDelay: '100ms' }}>
              {t.quiz.allCaughtUp}
            </div>
            <div className="animate-slide-up mt-2 text-muted-foreground" style={{ animationDelay: '200ms' }}>
              {t.quiz.noWordsDue}
            </div>
          </div>
        ) : (
          <PracticeFlashcard
            key={currentPracticeWord?.id ?? 'practice-loading'}
            word={currentPracticeWord}
            onSetPriority={handlePracticeSetPriority}
            onMaster={handlePracticeMaster}
            progress={{ current: practiceIndex + 1, total: practiceWords.length }}
            isLoading={loading}
          />
        )
      ) : !loading && dueWords.length === 0 ? (
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
        />
      )}
    </>
  );
}
