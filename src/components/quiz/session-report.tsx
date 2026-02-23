'use client';

import { Button } from '@/components/ui/button';
import { Flame, BookOpenCheck, Target, Sparkles } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

interface SessionReportProps {
  totalReviewed: number;
  newCards: number;
  againCount: number;
  streak: number;
  onContinue: () => void;
  onHome: () => void;
}

export function SessionReport({
  totalReviewed,
  newCards,
  againCount,
  streak,
  onContinue,
  onHome,
}: SessionReportProps) {
  const { t } = useTranslation();

  const accuracy = totalReviewed > 0
    ? Math.round(((totalReviewed - againCount) / totalReviewed) * 100)
    : 100;

  const feedbackMessage = (() => {
    if (accuracy === 100) return t.quiz.perfectScore;
    if (accuracy >= 80) return t.quiz.greatJob;
    if (accuracy >= 50) return t.quiz.keepGoing;
    return t.quiz.needsPractice;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div
          className="animate-scale-in mb-6 text-center text-3xl font-bold"
        >
          {feedbackMessage}
        </div>

        <div className="w-full max-w-sm space-y-4">
          <div
            className="animate-stagger flex items-center justify-between rounded-lg border p-4"
            style={{ '--stagger': 0 } as React.CSSProperties}
          >
            <div className="flex items-center gap-3">
              <BookOpenCheck className="size-5 text-primary" />
              <span className="text-sm">{t.quiz.cardsReviewed}</span>
            </div>
            <span className="text-lg font-semibold">{totalReviewed}</span>
          </div>

          <div
            className="animate-stagger flex items-center justify-between rounded-lg border p-4"
            style={{ '--stagger': 1 } as React.CSSProperties}
          >
            <div className="flex items-center gap-3">
              <Sparkles className="size-5 text-blue-500" />
              <span className="text-sm">{t.quiz.newCards}</span>
            </div>
            <span className="text-lg font-semibold">{newCards}</span>
          </div>

          <div
            className="animate-stagger flex items-center justify-between rounded-lg border p-4"
            style={{ '--stagger': 2 } as React.CSSProperties}
          >
            <div className="flex items-center gap-3">
              <Target className="size-5 text-green-500" />
              <span className="text-sm">{t.quiz.accuracy}</span>
            </div>
            <span className="text-lg font-semibold">{accuracy}%</span>
          </div>

          {streak > 0 && (
            <div
              className="animate-stagger flex items-center justify-between rounded-lg border p-4"
              style={{ '--stagger': 3 } as React.CSSProperties}
            >
              <div className="flex items-center gap-3">
                <Flame className="size-5 text-orange-500" />
                <span className="text-sm">{t.quiz.streak}</span>
              </div>
              <span className="text-lg font-semibold">
                {t.quiz.streakDays(streak)}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 bg-background px-4 pb-3">
        <div className="mb-3 h-px bg-border" />
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onHome}
          >
            {t.quiz.backToHome}
          </Button>
          <Button
            className="flex-1"
            onClick={onContinue}
          >
            {t.quiz.continueStudying}
          </Button>
        </div>
      </div>
    </div>
  );
}
