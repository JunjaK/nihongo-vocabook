'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
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

  const [dueWords, setDueWords] = useState<WordWithProgress[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(0);

  const loadDueWords = useCallback(async () => {
    setLoading(true);

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
    setLoading(false);
  }, [repo, wordId, wordbookId]);

  useEffect(() => {
    loadDueWords();
  }, [loadDueWords]);

  const handleRate = async (quality: number) => {
    const currentWord = dueWords[currentIndex];
    await repo.study.recordReview(currentWord.id, quality);
    setCompleted((c) => c + 1);

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

  const currentWord = dueWords[currentIndex];
  const title = wordId
    ? t.quiz.practice
    : wordbookId
      ? t.quiz.wordbookQuiz
      : t.quiz.title;

  return (
    <>
      <Header title={title} />
      <div className="p-4">
        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            {t.common.loading}
          </div>
        ) : dueWords.length === 0 ? (
          <div className="space-y-4 py-8 text-center">
            <div className="text-4xl">🎉</div>
            <div className="text-lg font-semibold">{t.quiz.allCaughtUp}</div>
            <div className="text-muted-foreground">
              {t.quiz.noWordsDue}
            </div>
            {completed > 0 && (
              <div className="text-sm text-muted-foreground">
                {t.quiz.reviewed(completed)}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {!wordId && (
              <div className="text-center text-sm text-muted-foreground">
                {currentIndex + 1} / {dueWords.length}
                {completed > 0 && ` · ${t.quiz.reviewCount(completed)}`}
              </div>
            )}
            {wordId && completed > 0 && (
              <div className="text-center text-sm text-muted-foreground">
                {t.quiz.reviewCount(completed)}
              </div>
            )}
            <Flashcard word={currentWord} onRate={handleRate} />
          </div>
        )}
      </div>
    </>
  );
}
