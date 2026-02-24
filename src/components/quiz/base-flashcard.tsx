'use client';

import { useState, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/lib/i18n';
import { bottomSep } from '@/lib/styles';
import type { Word } from '@/types/word';

interface BaseFlashcardProps {
  word?: Word;
  progress: { current: number; total: number };
  isLoading?: boolean;
  renderActions: (props: { word: Word; onAdvance: () => void }) => ReactNode;
  renderLoadingActions: () => ReactNode;
  testId?: string;
}

export function BaseFlashcard({
  word,
  progress,
  isLoading = false,
  renderActions,
  renderLoadingActions,
  testId = 'flashcard',
}: BaseFlashcardProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-0.5 w-full bg-muted" />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-10 w-48 rounded" />
          <Skeleton className="mt-2 h-5 w-32 rounded" />
        </div>
        <div className="shrink-0 px-4 pb-3 pt-3">
          <div className={bottomSep} />
          {renderLoadingActions()}
        </div>
      </div>
    );
  }

  if (!word) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Progress bar */}
      <div className="h-0.5 w-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Tap zone */}
      <div
        className="animate-card-enter relative min-h-0 flex-1 cursor-pointer px-4"
        onClick={() => setRevealed((v) => !v)}
        data-testid={testId}
      >
        {/* Term — absolutely centered, never moves */}
        <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center">
          <div className="text-4xl font-bold md:text-5xl">
            {word.term}
          </div>
        </div>

        {/* Reading (above center) */}
        <div className="absolute inset-x-4 top-1/2 -translate-y-[calc(100%+2rem)] text-center">
          {revealed && word.reading ? (
            <div className="animate-fade-in text-lg text-muted-foreground">
              {word.reading}
            </div>
          ) : null}
        </div>

        {/* Meaning + notes (below center) */}
        <div className="absolute inset-x-4 top-1/2 translate-y-8 text-center md:translate-y-10">
          {revealed ? (
            <>
              <div className="animate-reveal-up text-2xl font-semibold text-primary">
                {word.meaning}
              </div>
              {word.notes && (
                <div
                  className="animate-reveal-up mt-2 text-sm text-muted-foreground"
                  style={{ animationDelay: '100ms' }}
                >
                  {word.notes}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t.quiz.tapToReveal}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 px-4 pb-3 pt-3">
        <div className={bottomSep} />
        {renderActions({ word, onAdvance: () => setRevealed(false) })}
      </div>
    </div>
  );
}
