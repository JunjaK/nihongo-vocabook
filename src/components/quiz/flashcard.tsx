'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/lib/i18n';
import type { WordWithProgress } from '@/types/word';

interface FlashcardProps {
  word: WordWithProgress;
  onRate: (quality: number) => void;
}

export function Flashcard({ word, onRate }: FlashcardProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  const qualityLabels = [
    { quality: 0, label: t.quiz.again, variant: 'destructive' as const },
    { quality: 3, label: t.quiz.hard, variant: 'secondary' as const },
    { quality: 4, label: t.quiz.good, variant: 'default' as const },
    { quality: 5, label: t.quiz.easy, variant: 'outline' as const },
  ];

  return (
    <div className="flex flex-col items-center gap-6">
      <Card
        className="w-full cursor-pointer"
        onClick={() => setRevealed((v) => !v)}
        data-testid="flashcard"
      >
        <CardContent className="flex min-h-[200px] flex-col items-center justify-center p-6 text-center">
          <div className="text-3xl font-bold">{word.term}</div>
          <div className="mt-1 text-lg text-muted-foreground">
            {word.reading}
          </div>

          {revealed && (
            <div className="mt-6 space-y-2">
              <div className="text-2xl font-semibold text-primary">
                {word.meaning}
              </div>
              {word.notes && (
                <div className="text-sm text-muted-foreground">
                  {word.notes}
                </div>
              )}
            </div>
          )}

          {!revealed && (
            <div className="mt-6 text-sm text-muted-foreground">
              {t.quiz.tapToReveal}
            </div>
          )}
        </CardContent>
      </Card>

      {revealed && (
        <div className="flex w-full gap-2" data-testid="flashcard-rating">
          {qualityLabels.map(({ quality, label, variant }) => (
            <Button
              key={quality}
              variant={variant}
              className="flex-1"
              onClick={() => {
                onRate(quality);
                setRevealed(false);
              }}
              data-testid={`flashcard-rate-${quality}`}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
