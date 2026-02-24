'use client';

import { Button } from '@/components/ui/button';
import { Crown } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { BaseFlashcard } from './base-flashcard';
import type { Word } from '@/types/word';
import type { CardDirection } from '@/types/quiz';

interface PracticeFlashcardProps {
  word?: Word;
  onRecall: (wordId: string, known: boolean) => void;
  onMaster: (wordId: string) => void;
  progress: { current: number; total: number };
  isLoading?: boolean;
  cardDirection?: CardDirection;
}

export function PracticeFlashcard({ word, onRecall, onMaster, progress, isLoading = false, cardDirection }: PracticeFlashcardProps) {
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
            <Button variant="outline" disabled className="h-10 flex-1 rounded-lg border-rose-500/30 bg-rose-500/5 text-rose-300">{t.quiz.didntKnow}</Button>
            <Button variant="outline" disabled className="h-10 flex-1 rounded-lg border-emerald-500/30 bg-emerald-500/5 text-emerald-300">{t.quiz.knewIt}</Button>
          </div>
          <Button variant="outline" size="sm" disabled className="h-8 mt-2 w-full gap-1.5 text-xs">
            <Crown className="size-3.5" />
            {t.wordDetail.markMastered}
          </Button>
        </>
      )}
      renderActions={({ word: w, onAdvance }) => (
        <>
          <div className="flex gap-2" data-testid="practice-recall">
            <Button
              variant="outline"
              className="h-10 flex-1 rounded-lg border-rose-500/30 bg-rose-500/5 text-sm font-medium text-rose-300 hover:border-rose-400/40 hover:bg-rose-500/10"
              onClick={() => { onRecall(w.id, false); onAdvance(); }}
              data-testid="practice-recall-no"
            >
              {t.quiz.didntKnow}
            </Button>
            <Button
              variant="outline"
              className="h-10 flex-1 rounded-lg border-emerald-500/30 bg-emerald-500/5 text-sm font-medium text-emerald-300 hover:border-emerald-400/40 hover:bg-emerald-500/10"
              onClick={() => { onRecall(w.id, true); onAdvance(); }}
              data-testid="practice-recall-yes"
            >
              {t.quiz.knewIt}
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
