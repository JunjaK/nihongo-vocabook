'use client';

import { Button } from '@/components/ui/button';
import { Crown } from '@/components/ui/icons';
import { useTranslation } from '@/lib/i18n';
import { BaseFlashcard } from './base-flashcard';
import type { WordExample, WordWithProgress } from '@/types/word';
import type { CardDirection } from '@/types/quiz';

interface FlashcardProps {
  word?: WordWithProgress;
  examples?: WordExample[];
  onRate: (quality: number) => void;
  onMaster: () => void;
  progress: { current: number; total: number };
  isLoading?: boolean;
  cardDirection?: CardDirection;
}

export function Flashcard({ word, examples, onRate, onMaster, progress, isLoading = false, cardDirection }: FlashcardProps) {
  const { t } = useTranslation();

  return (
    <BaseFlashcard
      word={word}
      examples={examples}
      progress={progress}
      isLoading={isLoading}
      cardDirection={cardDirection}
      testId="flashcard"
      renderLoadingActions={() => (
        <>
          <div className="flex gap-2">
            <Button variant="outline" disabled className="h-12 flex-1 rounded-lg border-destructive/40 text-sm font-medium text-destructive">{t.quiz.again}</Button>
            <Button disabled className="h-12 flex-1 rounded-lg bg-secondary text-sm font-medium text-muted-foreground">{t.quiz.hard}</Button>
            <Button disabled className="h-12 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground">{t.quiz.good}</Button>
            <Button disabled className="h-12 flex-1 rounded-lg bg-accent text-sm font-semibold text-primary dark:text-accent-muted">{t.quiz.easy}</Button>
          </div>
          <Button variant="outline" disabled className="h-12 w-full rounded-lg text-sm">
            <Crown className="size-4" />
            {t.wordDetail.markMastered}
          </Button>
        </>
      )}
      renderActions={({ onAdvance }) => (
        <>
          <div className="flex gap-2" data-testid="flashcard-rating">
            <Button
              variant="outline"
              className="h-12 flex-1 rounded-lg border-destructive/40 text-sm font-medium text-destructive hover:bg-destructive/10"
              onClick={() => { onRate(0); onAdvance(); }}
              data-testid="flashcard-rate-0"
            >
              {t.quiz.again}
            </Button>
            <Button
              variant="secondary"
              className="h-12 flex-1 rounded-lg text-sm font-medium text-muted-foreground"
              onClick={() => { onRate(3); onAdvance(); }}
              data-testid="flashcard-rate-3"
            >
              {t.quiz.hard}
            </Button>
            <Button
              className="h-12 flex-1 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              onClick={() => { onRate(4); onAdvance(); }}
              data-testid="flashcard-rate-4"
            >
              {t.quiz.good}
            </Button>
            <Button
              className="h-12 flex-1 rounded-lg bg-accent text-sm font-semibold text-primary hover:bg-accent/80 dark:text-accent-muted"
              onClick={() => { onRate(5); onAdvance(); }}
              data-testid="flashcard-rate-5"
            >
              {t.quiz.easy}
            </Button>
          </div>
          <Button
            variant="outline"
            className="h-12 w-full rounded-lg text-sm"
            onClick={() => { onMaster(); onAdvance(); }}
            data-testid="flashcard-rate-master"
          >
            <Crown className="size-4" />
            {t.wordDetail.markMastered}
          </Button>
        </>
      )}
    />
  );
}
