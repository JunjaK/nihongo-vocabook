'use client';

import { Button } from '@/components/ui/button';
import { Flame, BookOpenCheck, Target, Sparkles, Crown, CheckCircle, TrendingUp, AlertTriangle, PartyPopper } from '@/components/ui/icons';
import { useTranslation } from '@/lib/i18n';
import { computeWeightedAccuracy } from '@/types/quiz';
import { bottomBar, bottomSep } from '@/lib/styles';

interface SessionReportProps {
  stats: {
    totalReviewed: number;
    newCards: number;
    againCount: number;
    reviewAgainCount: number;
    newAgainCount: number;
    hardCount: number;
    goodCount: number;
    easyCount: number;
    masteredCount: number;
  };
  streak: number;
  onContinue: () => void;
  onHome: () => void;
}

const RATING_COLORS = {
  again: 'bg-red-500',
  hard: 'bg-orange-500',
  good: 'bg-blue-500',
  easy: 'bg-green-500',
};

export function SessionReport({
  stats,
  streak,
  onContinue,
  onHome,
}: SessionReportProps) {
  const { t } = useTranslation();

  const { totalReviewed, newCards } = stats;

  const accuracy = computeWeightedAccuracy({
    ...stats,
    masteredInSessionCount: stats.masteredCount,
  });

  const feedbackIcon = accuracy === 100 ? PartyPopper
    : accuracy >= 80 ? CheckCircle
    : accuracy >= 50 ? TrendingUp
    : AlertTriangle;
  const FeedbackIcon = feedbackIcon;

  const feedbackMessage = (() => {
    if (accuracy === 100) return t.quiz.perfectScore;
    if (accuracy >= 80) return t.quiz.greatJob;
    if (accuracy >= 50) return t.quiz.keepGoing;
    return t.quiz.needsPractice;
  })();

  let stagger = 0;

  // Rating distribution mini bar
  const ratingTotal = stats.againCount + stats.hardCount + stats.goodCount + stats.easyCount;
  const ratingSegments = ratingTotal > 0 ? [
    { key: 'again', count: stats.againCount, color: RATING_COLORS.again, label: t.quiz.again },
    { key: 'hard', count: stats.hardCount, color: RATING_COLORS.hard, label: t.quiz.hard },
    { key: 'good', count: stats.goodCount, color: RATING_COLORS.good, label: t.quiz.good },
    { key: 'easy', count: stats.easyCount, color: RATING_COLORS.easy, label: t.quiz.easy },
  ].filter((s) => s.count > 0) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="animate-scale-in mb-6 flex flex-col items-center gap-2 text-center">
          <FeedbackIcon className="size-8 text-primary" />
          <div className="text-3xl font-bold">{feedbackMessage}</div>
        </div>

        <div className="w-full max-w-sm space-y-4">
          <div
            className="animate-stagger flex items-center justify-between rounded-lg border p-4"
            style={{ '--stagger': stagger++ } as React.CSSProperties}
          >
            <div className="flex items-center gap-3">
              <BookOpenCheck className="size-5 text-primary" />
              <span className="text-sm">{t.quiz.cardsReviewed}</span>
            </div>
            <span className="text-lg font-semibold">{totalReviewed}</span>
          </div>

          <div
            className="animate-stagger flex items-center justify-between rounded-lg border p-4"
            style={{ '--stagger': stagger++ } as React.CSSProperties}
          >
            <div className="flex items-center gap-3">
              <Sparkles className="size-5 text-blue-500" />
              <span className="text-sm">{t.quiz.newCards}</span>
            </div>
            <span className="text-lg font-semibold">{newCards}</span>
          </div>

          <div
            className="animate-stagger flex flex-col rounded-lg border p-4"
            style={{ '--stagger': stagger++ } as React.CSSProperties}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Target className="size-5 text-green-500" />
                <span className="text-sm">{t.quiz.accuracy}</span>
              </div>
              <span className="text-lg font-semibold">{accuracy}%</span>
            </div>
            {ratingSegments.length > 0 && (
              <div className="mt-2.5 space-y-1.5 pl-8">
                <div className="flex h-2 overflow-hidden rounded-full">
                  {ratingSegments.map((s) => (
                    <div
                      key={s.key}
                      className={`${s.color} transition-all`}
                      style={{ width: `${(s.count / ratingTotal) * 100}%` }}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                  {ratingSegments.map((s) => (
                    <span key={s.key} className="flex items-center gap-1">
                      <span className={`inline-block size-1.5 rounded-full ${s.color}`} />
                      {s.label} {s.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {stats.masteredCount > 0 && (
            <div
              className="animate-stagger flex items-center justify-between rounded-lg border p-4"
              style={{ '--stagger': stagger++ } as React.CSSProperties}
            >
              <div className="flex items-center gap-3">
                <Crown className="size-5 text-yellow-500" />
                <span className="text-sm">{t.quiz.masteredInSession(stats.masteredCount)}</span>
              </div>
            </div>
          )}

          {streak > 0 && (
            <div
              className="animate-stagger flex items-center justify-between rounded-lg border p-4"
              style={{ '--stagger': stagger++ } as React.CSSProperties}
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

      <div className={bottomBar}>
        <div className={bottomSep} />
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
