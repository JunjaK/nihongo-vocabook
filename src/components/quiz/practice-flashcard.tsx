'use client';

import { Button } from '@/components/ui/button';
import { Crown } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { BaseFlashcard } from './base-flashcard';
import type { Word } from '@/types/word';
import type { CardDirection } from '@/types/quiz';

interface PracticeFlashcardProps {
  word?: Word;
  onSetPriority: (wordId: string, priority: number) => void;
  onMaster: (wordId: string) => void;
  progress: { current: number; total: number };
  isLoading?: boolean;
  cardDirection?: CardDirection;
}

export function PracticeFlashcard({ word, onSetPriority, onMaster, progress, isLoading = false, cardDirection }: PracticeFlashcardProps) {
  const { t } = useTranslation();

  return (
    <BaseFlashcard
      word={word}
      progress={progress}
      isLoading={isLoading}
      cardDirection={cardDirection}
      testId="practice-flashcard"
      renderLoadingActions={() => (
        <>
          <div className="flex gap-2">
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-rose-500/30 bg-rose-500/5 text-rose-300">{t.quiz.priorityHigh}</Button>
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-amber-500/30 bg-amber-500/5 text-amber-300">{t.quiz.priorityNormal}</Button>
            <Button variant="outline" disabled className="h-8 flex-1 rounded-lg border-emerald-500/30 bg-emerald-500/5 text-emerald-300">{t.quiz.priorityLow}</Button>
          </div>
          <Button variant="outline" size="sm" disabled className="h-8 mt-2 w-full gap-1.5 text-xs">
            <Crown className="size-3.5" />
            {t.wordDetail.markMastered}
          </Button>
        </>
      )}
      renderActions={({ word: w }) => (
        <>
          <div className="flex gap-2" data-testid="practice-priority">
            <Button
              variant={w.priority === 1 ? 'default' : 'outline'}
              className={`h-8 flex-1 rounded-lg ${w.priority === 1 ? 'border-rose-400/60 bg-rose-500/20 text-rose-200 hover:border-rose-300/70 hover:bg-rose-500/25' : 'border-rose-500/30 bg-rose-500/5 text-rose-300 hover:border-rose-400/40 hover:bg-rose-500/10'}`}
              onClick={() => onSetPriority(w.id, 1)}
              data-testid="practice-priority-high"
            >
              {t.quiz.priorityHigh}
            </Button>
            <Button
              variant={w.priority === 2 ? 'default' : 'outline'}
              className={`h-8 flex-1 rounded-lg ${w.priority === 2 ? 'border-amber-400/60 bg-amber-500/20 text-amber-200 hover:border-amber-300/70 hover:bg-amber-500/25' : 'border-amber-500/30 bg-amber-500/5 text-amber-300 hover:border-amber-400/40 hover:bg-amber-500/10'}`}
              onClick={() => onSetPriority(w.id, 2)}
              data-testid="practice-priority-normal"
            >
              {t.quiz.priorityNormal}
            </Button>
            <Button
              variant={w.priority === 3 ? 'default' : 'outline'}
              className={`h-8 flex-1 rounded-lg ${w.priority === 3 ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200 hover:border-emerald-300/70 hover:bg-emerald-500/25' : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:border-emerald-400/40 hover:bg-emerald-500/10'}`}
              onClick={() => onSetPriority(w.id, 3)}
              data-testid="practice-priority-low"
            >
              {t.quiz.priorityLow}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full gap-1.5 text-xs"
            onClick={() => onMaster(w.id)}
            data-testid="practice-master"
          >
            <Crown className="size-3.5" />
            {t.wordDetail.markMastered}
          </Button>
        </>
      )}
    />
  );
}
