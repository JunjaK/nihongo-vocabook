'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n';
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
        <Card
          className="w-full cursor-pointer"
          onClick={() => setRevealed((v) => !v)}
          data-testid="flashcard"
        >
          <CardContent className="relative h-[280px] p-6 text-center">
            <div className="absolute inset-x-6 top-1/3 -translate-y-1/2 text-center">
              <div className="text-3xl font-bold">{word.term}</div>
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
        <div className="mx-4 mb-3 h-px bg-border" />
        <div className="flex gap-2" data-testid="flashcard-rating">
          <Button
            variant="outline"
            className="flex-1 border-destructive text-destructive hover:bg-destructive/10"
            onClick={() => { onRate(0); setRevealed(false); }}
            data-testid="flashcard-rate-0"
          >
            {t.quiz.again}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { onRate(3); setRevealed(false); }}
            data-testid="flashcard-rate-3"
          >
            {t.quiz.hard}
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => { onRate(4); setRevealed(false); }}
            data-testid="flashcard-rate-4"
          >
            {t.quiz.good}
          </Button>
          {showMaster && (
            <Button
              variant="outline"
              className="flex-1 border-primary text-primary hover:bg-primary/10"
              onClick={() => { onMaster(); setRevealed(false); }}
              data-testid="flashcard-rate-master"
            >
              {t.wordDetail.markMastered}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
