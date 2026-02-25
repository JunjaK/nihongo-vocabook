'use client';

import { use, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpenCheck } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/layout/header';
import { PracticeFlashcard } from '@/components/quiz/practice-flashcard';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { useWakeLock } from '@/hooks/use-wake-lock';
import { bottomBar, bottomSep } from '@/lib/styles';
import { markWordMastered } from '@/lib/actions/mark-mastered';
import { invalidateListCache } from '@/lib/list-cache';
import { selectPracticeWords } from '@/lib/quiz/word-scoring';
import { requestDueCountRefresh } from '@/lib/quiz/due-count-sync';
import { getLocalDateString } from '@/lib/quiz/session-store';
import type { Word } from '@/types/word';
import type { CardDirection } from '@/types/quiz';

export default function PracticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: wordbookId } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const authLoading = useAuthStore((s) => s.loading);
  const { t } = useTranslation();

  useWakeLock(!authLoading);

  const [wordbookName, setWordbookName] = useState('');
  const [practiceWords, setPracticeWords] = useState<Word[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceStats, setPracticeStats] = useState({ total: 0, knownCount: 0, masteredCount: 0 });
  const [practiceComplete, setPracticeComplete] = useState(false);
  const [cardDirection, setCardDirection] = useState<CardDirection>('term_first');

  const [loading, reload] = useLoader(async () => {
    const [settings, wb, allWords] = await Promise.all([
      repo.study.getQuizSettings(),
      repo.wordbooks.getById(wordbookId),
      repo.wordbooks.getWords(wordbookId),
    ]);
    if (wb) setWordbookName(wb.name);
    setCardDirection(settings.cardDirection);
    const nonMastered = allWords.filter((w) => !w.mastered);
    const selected = selectPracticeWords(nonMastered, settings.sessionSize, settings.jlptFilter);
    setPracticeWords(selected);
    setPracticeIndex(0);
    setPracticeStats({ total: selected.length, knownCount: 0, masteredCount: 0 });
    setPracticeComplete(false);
  }, [repo, wordbookId], { skip: authLoading });

  useEffect(() => {
    return () => {
      requestDueCountRefresh();
    };
  }, []);

  const advancePractice = useCallback(() => {
    setPracticeWords((words) => {
      setPracticeIndex((idx) => {
        if (idx + 1 < words.length) {
          return idx + 1;
        }
        setPracticeComplete(true);
        return idx;
      });
      return words;
    });
  }, []);

  const handleRecall = async (wId: string, known: boolean) => {
    try {
      if (!known) {
        await repo.words.setPriority(wId, 1);
        invalidateListCache('words');
        setPracticeWords((prev) =>
          prev.map((w) => (w.id === wId ? { ...w, priority: 1 } : w)),
        );
      }
      await repo.study.incrementPracticeStats(getLocalDateString(), known);
      setPracticeStats((prev) => ({
        ...prev,
        knownCount: prev.knownCount + (known ? 1 : 0),
      }));
      advancePractice();
    } catch (error) {
      console.error('Failed to record practice recall', error);
    }
  };

  const handleMaster = async (wId: string) => {
    await markWordMastered(repo, wId);
    setPracticeStats((prev) => ({ ...prev, masteredCount: prev.masteredCount + 1 }));
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
    await reload();
  };

  const handleBackToWordbook = () => {
    router.push(`/wordbooks/${wordbookId}`);
  };

  const currentWord = practiceWords[practiceIndex];
  const progressCount = !loading && practiceWords.length > 0
    ? `${practiceIndex + 1}/${practiceWords.length}`
    : undefined;

  if (practiceComplete) {
    return (
      <>
        <Header title={t.quiz.practiceComplete} showBack />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <BookOpenCheck className="animate-scale-in size-10 text-primary" />
            <div className="animate-slide-up mt-4 text-lg font-semibold" style={{ animationDelay: '100ms' }}>
              {t.quiz.practiceComplete}
            </div>
            <div className="animate-slide-up mt-2 text-muted-foreground" style={{ animationDelay: '200ms' }}>
              {t.quiz.practicedCount(practiceStats.total)}
            </div>
            <div className="animate-slide-up mt-1 text-muted-foreground" style={{ animationDelay: '250ms' }}>
              {t.quiz.knownCount(practiceStats.knownCount)}
            </div>
            {practiceStats.masteredCount > 0 && (
              <div className="animate-slide-up mt-1 text-muted-foreground" style={{ animationDelay: '300ms' }}>
                {t.quiz.masteredInSession(practiceStats.masteredCount)}
              </div>
            )}
          </div>
          <div className={bottomBar} style={{ animationDelay: '400ms' }}>
            <div className={bottomSep} />
            <div className="flex gap-2">
              <Button className="flex-1" variant="outline" onClick={handlePracticeAgain}>
                {t.quiz.practiceAgain}
              </Button>
              <Button className="flex-1" onClick={handleBackToWordbook}>
                {t.quiz.backToWordbook}
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title={wordbookName || t.quiz.wordbookQuiz}
        showBack
        actions={
          <div className="flex items-center gap-1.5">
            {loading ? (
              <div className="h-7 w-16 animate-pulse rounded-full bg-muted" />
            ) : progressCount ? (
              <span className="inline-flex h-7 items-center rounded-full border border-border/60 bg-muted/30 px-2.5 text-xs">
                <span className="tabular-nums font-medium text-foreground/90">{progressCount}</span>
              </span>
            ) : null}
          </div>
        }
      />
      {!loading && practiceWords.length === 0 ? (
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
          key={currentWord?.id ?? 'practice-loading'}
          word={currentWord}
          onRecall={handleRecall}
          onMaster={handleMaster}
          progress={{ current: practiceIndex + 1, total: practiceWords.length }}
          isLoading={loading}
          cardDirection={cardDirection}
        />
      )}
    </>
  );
}
