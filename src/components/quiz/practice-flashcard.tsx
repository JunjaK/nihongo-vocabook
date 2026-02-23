'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Crown } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { bottomSep } from '@/lib/styles';
import type { Word } from '@/types/word';

interface PracticeFlashcardProps {
  word?: Word;
  onSetPriority: (wordId: string, priority: number) => void;
  onMaster: (wordId: string) => void;
  progress: { current: number; total: number };
  isLoading?: boolean;
}

export function PracticeFlashcard({ word, onSetPriority, onMaster, progress, isLoading = false }: PracticeFlashcardProps) {
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
          <div className="flex gap-2">
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-rose-500/30 bg-rose-500/5 text-rose-300">{t.quiz.priorityHigh}</Button>
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-amber-500/30 bg-amber-500/5 text-amber-300">{t.quiz.priorityNormal}</Button>
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-emerald-500/30 bg-emerald-500/5 text-emerald-300">{t.quiz.priorityLow}</Button>
          </div>
          <Button variant="outline" size="sm" disabled className="h-8 mt-2 w-full gap-1.5 text-xs">
            <Crown className="size-3.5" />
            {t.wordDetail.markMastered}
          </Button>
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
        data-testid="practice-flashcard"
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

      {/* Priority buttons + master */}
      <div className="shrink-0 px-4 pb-3 pt-3">
        <div className={bottomSep} />
        <div className="flex gap-2" data-testid="practice-priority">
          <Button
            variant={word.priority === 1 ? 'default' : 'outline'}
            className={`h-8 flex-1 rounded-lg ${word.priority === 1 ? 'border-rose-400/60 bg-rose-500/20 text-rose-200 hover:border-rose-300/70 hover:bg-rose-500/25' : 'border-rose-500/30 bg-rose-500/5 text-rose-300 hover:border-rose-400/40 hover:bg-rose-500/10'}`}
            onClick={() => onSetPriority(word.id, 1)}
            data-testid="practice-priority-high"
          >
            {t.quiz.priorityHigh}
          </Button>
          <Button
            variant={word.priority === 2 ? 'default' : 'outline'}
            className={`h-8 flex-1 rounded-lg ${word.priority === 2 ? 'border-amber-400/60 bg-amber-500/20 text-amber-200 hover:border-amber-300/70 hover:bg-amber-500/25' : 'border-amber-500/30 bg-amber-500/5 text-amber-300 hover:border-amber-400/40 hover:bg-amber-500/10'}`}
            onClick={() => onSetPriority(word.id, 2)}
            data-testid="practice-priority-normal"
          >
            {t.quiz.priorityNormal}
          </Button>
          <Button
            variant={word.priority === 3 ? 'default' : 'outline'}
            className={`h-8 flex-1 rounded-lg ${word.priority === 3 ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200 hover:border-emerald-300/70 hover:bg-emerald-500/25' : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:border-emerald-400/40 hover:bg-emerald-500/10'}`}
            onClick={() => onSetPriority(word.id, 3)}
            data-testid="practice-priority-low"
          >
            {t.quiz.priorityLow}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full gap-1.5 text-xs"
          onClick={() => onMaster(word.id)}
          data-testid="practice-master"
        >
          <Crown className="size-3.5" />
          {t.wordDetail.markMastered}
        </Button>
      </div>
    </div>
  );
}
