'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpenCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/layout/header';
import { PracticeFlashcard } from '@/components/quiz/practice-flashcard';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { markWordMastered } from '@/lib/actions/mark-mastered';
import { invalidateListCache } from '@/lib/list-cache';
import { selectPracticeWords } from '@/lib/quiz/word-scoring';
import { requestDueCountRefresh } from '@/lib/quiz/due-count-sync';
import type { Word } from '@/types/word';

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

  const [wordbookName, setWordbookName] = useState('');
  const [practiceWords, setPracticeWords] = useState<Word[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceStats, setPracticeStats] = useState({ total: 0, masteredCount: 0 });
  const [practiceComplete, setPracticeComplete] = useState(false);

  // Refs to avoid stale closures in setTimeout
  const practiceWordsRef = useRef(practiceWords);
  const practiceIndexRef = useRef(practiceIndex);
  useEffect(() => { practiceWordsRef.current = practiceWords; }, [practiceWords]);
  useEffect(() => { practiceIndexRef.current = practiceIndex; }, [practiceIndex]);

  const [loading, reload] = useLoader(async () => {
    const [settings, wb, allWords] = await Promise.all([
      repo.study.getQuizSettings(),
      repo.wordbooks.getById(wordbookId),
      repo.wordbooks.getWords(wordbookId),
    ]);
    if (wb) setWordbookName(wb.name);
    const nonMastered = allWords.filter((w) => !w.mastered);
    const selected = selectPracticeWords(nonMastered, settings.newPerDay, settings.jlptFilter);
    setPracticeWords(selected);
    setPracticeIndex(0);
    setPracticeStats({ total: selected.length, masteredCount: 0 });
    setPracticeComplete(false);
  }, [repo, wordbookId], { skip: authLoading });

  useEffect(() => {
    return () => {
      requestDueCountRefresh();
    };
  }, []);

  const handleSetPriority = async (wId: string, priority: number) => {
    try {
      await repo.words.setPriority(wId, priority);
      invalidateListCache('words');
      setPracticeWords((prev) =>
        prev.map((w) => (w.id === wId ? { ...w, priority } : w)),
      );
      setTimeout(() => {
        if (practiceIndexRef.current + 1 < practiceWordsRef.current.length) {
          setPracticeIndex((i) => i + 1);
        } else {
          setPracticeComplete(true);
        }
      }, 300);
    } catch (error) {
      console.error('Failed to update priority', error);
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
          onSetPriority={handleSetPriority}
          onMaster={handleMaster}
          progress={{ current: practiceIndex + 1, total: practiceWords.length }}
          isLoading={loading}
        />
      )}
    </>
  );
}
