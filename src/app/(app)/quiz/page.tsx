'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { BookOpenCheck } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Flashcard } from '@/components/quiz/flashcard';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { WordWithProgress } from '@/types/word';

export default function QuizPage() {
  return (
    <Suspense>
      <QuizContent />
    </Suspense>
  );
}

function QuizContent() {
  const repo = useRepository();
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const wordId = searchParams.get('wordId');
  const wordbookId = searchParams.get('wordbookId');
  const isSubscribed = searchParams.get('subscribed') === 'true';

  const [dueWords, setDueWords] = useState<WordWithProgress[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(0);
  const loadStart = useRef(0);

  const loadDueWords = useCallback(async () => {
    setLoading(true);
    loadStart.current = Date.now();

    if (wordId) {
      const word = await repo.words.getById(wordId);
      if (word) {
        const progress = await repo.study.getProgress(wordId);
        setDueWords([{ ...word, progress }]);
      } else {
        setDueWords([]);
      }
    } else if (wordbookId) {
      const words = await repo.wordbooks.getWords(wordbookId);
      const wordsWithProgress: WordWithProgress[] = [];
      for (const word of words) {
        const progress = await repo.study.getProgress(word.id);
        wordsWithProgress.push({ ...word, progress });
      }
      setDueWords(wordsWithProgress);
    } else {
      const words = await repo.study.getDueWords(20);
      setDueWords(words);
    }

    setCurrentIndex(0);
    setCompleted(0);
    const remaining = 300 - (Date.now() - loadStart.current);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    setLoading(false);
  }, [repo, wordId, wordbookId]);

  useEffect(() => {
    loadDueWords();
  }, [loadDueWords]);

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
      } else if (wordbookId) {
        await loadDueWords();
      } else {
        await loadDueWords();
      }
    }
  };

  const handleRate = async (quality: number) => {
    const currentWord = dueWords[currentIndex];
    await repo.study.recordReview(currentWord.id, quality);
    setCompleted((c) => c + 1);
    await advanceToNext();
  };

  const handleMaster = async () => {
    const currentWord = dueWords[currentIndex];
    await repo.words.setMastered(currentWord.id, true);
    setDueWords((prev) => prev.filter((_, i) => i !== currentIndex));
    setCompleted((c) => c + 1);
    if (currentIndex >= dueWords.length - 1) {
      setCurrentIndex(0);
    }
  };

  const currentWord = dueWords[currentIndex];
  const title = wordId
    ? t.quiz.practice
    : wordbookId
      ? t.quiz.wordbookQuiz
      : t.quiz.title;

  const progressText = !loading && dueWords.length > 0
    ? wordId
      ? completed > 0 ? t.quiz.reviewCount(completed) : undefined
      : `${currentIndex + 1} / ${dueWords.length}${completed > 0 ? ` · ${t.quiz.reviewCount(completed)}` : ''}`
    : undefined;

  return (
    <>
      <Header
        title={title}
        showBack={!!(wordId || wordbookId)}
        actions={
          progressText && (
            <span className="text-sm text-muted-foreground">{progressText}</span>
          )
        }
      />
      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner className="size-8" />
          {t.common.loading}
        </div>
      ) : dueWords.length === 0 ? (
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
          word={currentWord}
          onRate={handleRate}
          onMaster={handleMaster}
          showMaster={!isSubscribed}
        />
      )}
    </>
  );
}
