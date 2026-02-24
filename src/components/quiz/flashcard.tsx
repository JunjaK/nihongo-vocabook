'use client';

import { Button } from '@/components/ui/button';
import { Crown } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { BaseFlashcard } from './base-flashcard';
import type { WordWithProgress } from '@/types/word';
import type { CardDirection } from '@/types/quiz';

interface FlashcardProps {
  word?: WordWithProgress;
  onRate: (quality: number) => void;
  onMaster: () => void;
  progress: { current: number; total: number };
  isLoading?: boolean;
  cardDirection?: CardDirection;
}

export function Flashcard({ word, onRate, onMaster, progress, isLoading = false, cardDirection }: FlashcardProps) {
  const { t } = useTranslation();

  return (
    <BaseFlashcard
      word={word}
      progress={progress}
      isLoading={isLoading}
      cardDirection={cardDirection}
      testId="flashcard"
      renderLoadingActions={() => (
        <>
          <div className="flex gap-2">
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-rose-500/30 bg-rose-500/5 text-sm text-rose-300">{t.quiz.again}</Button>
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-primary/40 bg-primary/15 text-sm text-primary">{t.quiz.hard}</Button>
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-amber-500/30 bg-amber-500/5 text-sm text-amber-300">{t.quiz.good}</Button>
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-emerald-500/30 bg-emerald-500/5 text-sm text-emerald-300">{t.quiz.easy}</Button>
          </div>
          <Button variant="outline" size="sm" disabled className="h-8 mt-2 w-full gap-1.5 text-xs">
            <Crown className="size-3.5" />
            {t.wordDetail.markMastered}
          </Button>
        </>
      )}
      renderActions={({ onAdvance }) => (
        <>
          <div className="flex gap-2" data-testid="flashcard-rating">
            <Button
              variant="outline"
              className="h-8 flex-1 rounded-lg border-rose-500/30 bg-rose-500/5 text-sm text-rose-300 hover:border-rose-400/40 hover:bg-rose-500/10"
              onClick={() => { onRate(0); onAdvance(); }}
              data-testid="flashcard-rate-0"
            >
              {t.quiz.again}
            </Button>
            <Button
              variant="outline"
              className="h-8 flex-1 rounded-lg border-primary/40 bg-primary/15 text-sm text-primary hover:border-primary hover:bg-primary/25"
              onClick={() => { onRate(3); onAdvance(); }}
              data-testid="flashcard-rate-3"
            >
              {t.quiz.hard}
            </Button>
            <Button
              variant="outline"
              className="h-8 flex-1 rounded-lg border-amber-500/30 bg-amber-500/5 text-sm text-amber-300 hover:border-amber-400/40 hover:bg-amber-500/10"
              onClick={() => { onRate(4); onAdvance(); }}
              data-testid="flashcard-rate-4"
            >
              {t.quiz.good}
            </Button>
            <Button
              variant="outline"
              className="h-8 flex-1 rounded-lg border-emerald-500/30 bg-emerald-500/5 text-sm text-emerald-300 hover:border-emerald-400/40 hover:bg-emerald-500/10"
              onClick={() => { onRate(5); onAdvance(); }}
              data-testid="flashcard-rate-5"
            >
              {t.quiz.easy}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 mt-2 w-full gap-1.5 text-xs"
            onClick={() => { onMaster(); onAdvance(); }}
            data-testid="flashcard-rate-master"
          >
            <Crown className="size-3.5" />
            {t.wordDetail.markMastered}
          </Button>
        </>
      )}
    />
  );
}
