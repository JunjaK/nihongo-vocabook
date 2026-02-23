'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n';
import { getReviewPreview } from '@/lib/spaced-repetition';
import type { WordWithProgress } from '@/types/word';

interface FlashcardProps {
  word: WordWithProgress;
  onRate: (quality: number) => void;
  onMaster: () => void;
  showMaster?: boolean;
}

export function Flashcard({ word, onRate, onMaster, showMaster = true }: FlashcardProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  const preview = useMemo(() => getReviewPreview(word.progress), [word.progress]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
        <Card
          className="animate-scale-in w-full cursor-pointer"
          onClick={() => setRevealed((v) => !v)}
          data-testid="flashcard"
        >
          <CardContent className="relative h-[280px] p-6 text-center">
            <div className="absolute inset-x-6 top-1/3 -translate-y-1/2 text-center">
              <div className="flex items-center justify-center gap-2 text-3xl font-bold">
                {word.priority === 1 && (
                  <span className="size-2.5 shrink-0 rounded-full bg-red-500" />
                )}
                {word.priority === 3 && (
                  <span className="size-2.5 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600" />
                )}
                {word.term}
              </div>
            </div>
            <div className="absolute inset-x-6 top-1/2 pt-2 text-center">
              {revealed ? (
                <>
                  <div className="text-lg text-muted-foreground">
                    {word.reading}
                  </div>
                  <div className="mt-3 text-2xl font-semibold text-primary">
                    {word.meaning}
                  </div>
                  {word.notes && (
                    <div className="mt-2 text-sm text-muted-foreground">
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
          </CardContent>
        </Card>
      </div>

      <div className="shrink-0 px-4 pb-3 pt-3">
        <div className="mb-3 h-px bg-border" />
        <div className="flex gap-2" data-testid="flashcard-rating">
          <Button
            variant="outline"
            className="flex-1 flex-col gap-0 border-destructive py-1.5 text-destructive hover:bg-destructive/10"
            onClick={() => { onRate(0); setRevealed(false); }}
            data-testid="flashcard-rate-0"
          >
            <span className="text-sm">{t.quiz.again}</span>
            <span className="text-[10px] opacity-60">{preview.again}</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 flex-col gap-0 py-1.5"
            onClick={() => { onRate(3); setRevealed(false); }}
            data-testid="flashcard-rate-3"
          >
            <span className="text-sm">{t.quiz.hard}</span>
            <span className="text-[10px] opacity-60">{preview.hard}</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 flex-col gap-0 py-1.5"
            onClick={() => { onRate(4); setRevealed(false); }}
            data-testid="flashcard-rate-4"
          >
            <span className="text-sm">{t.quiz.good}</span>
            <span className="text-[10px] opacity-60">{preview.good}</span>
          </Button>
          <Button
            variant="outline"
            className="flex-1 flex-col gap-0 border-primary py-1.5 text-primary hover:bg-primary/10"
            onClick={() => { onRate(5); setRevealed(false); }}
            data-testid="flashcard-rate-5"
          >
            <span className="text-sm">{t.quiz.easy}</span>
            <span className="text-[10px] opacity-60">{preview.easy}</span>
          </Button>
        </div>
        {showMaster && (
          <Button
            variant="outline"
            className="mt-2 w-full"
            onClick={() => { onMaster(); setRevealed(false); }}
            data-testid="flashcard-rate-master"
          >
            {t.wordDetail.markMastered}
          </Button>
        )}
      </div>
    </div>
  );
}
