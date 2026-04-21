'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslation } from '@/lib/i18n';
import { bottomSep } from '@/lib/styles';
import { cn } from '@/lib/utils';
import { maskSentence, BLANK_PLACEHOLDER } from '@/lib/quiz/example-quiz';
import type { QuizCard } from '@/types/quiz';

interface ExampleQuizCardProps {
  card?: Extract<QuizCard, { kind: 'example' }>;
  onAnswer: (correct: boolean) => void;
  onAdvance: () => void;
  progress: { current: number; total: number };
  isLoading?: boolean;
}

type Phase = 'choosing' | 'revealed';

export function ExampleQuizCard({
  card,
  onAnswer,
  onAdvance,
  progress,
  isLoading = false,
}: ExampleQuizCardProps) {
  const { t } = useTranslation();
  const [selectedTerm, setSelectedTerm] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('choosing');

  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  if (isLoading || !card) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-[3px] w-full bg-secondary" />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-10 w-48 rounded" />
        </div>
        <div className="shrink-0 px-5 pb-2 pt-3">
          <div className={bottomSep} />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  const correctTerm = card.word.term;
  const choices: { id: string; term: string }[] = [
    { id: `choice-correct-${card.word.id}`, term: correctTerm },
    { id: `choice-d0-${card.distractors[0].id}`, term: card.distractors[0].term },
    { id: `choice-d1-${card.distractors[1].id}`, term: card.distractors[1].term },
  ];
  // Shuffle choices deterministically per card — use word id hash as seed proxy.
  // For simplicity, use a stable shuffle at mount via useState.
  const orderedChoices = useStableShuffle(choices, card.example.id);

  const masked = maskSentence(card.example.sentenceJa, correctTerm);

  function handleSelect(term: string) {
    if (phase !== 'choosing') return;
    setSelectedTerm(term);
    const correct = term === correctTerm;
    onAnswer(correct);
    setPhase('revealed');
  }

  function handleNext() {
    setSelectedTerm(null);
    setPhase('choosing');
    onAdvance();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Progress bar */}
      <div className="h-[3px] w-full bg-secondary">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div
        className="animate-card-enter relative min-h-0 flex-1 overflow-y-auto px-5 pt-8"
        data-testid="example-card"
      >
        <div className="mb-6 text-center text-xs font-semibold uppercase tracking-wide text-text-tertiary">
          {t.quiz.fillTheBlank}
        </div>

        <div className="text-center text-xl font-medium leading-relaxed md:text-2xl">
          {renderMasked(masked, phase === 'revealed' ? correctTerm : null)}
        </div>

        {phase === 'revealed' && (
          <div className="animate-reveal-up mt-6 flex flex-col items-center gap-1 text-center">
            {card.example.sentenceReading && (
              <div className="text-reading text-text-secondary">
                {card.example.sentenceReading}
              </div>
            )}
            {card.example.sentenceMeaning && (
              <div className="text-sm text-primary dark:text-accent-muted">
                {card.example.sentenceMeaning}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions — 3 choice buttons, then advance button after answer */}
      <div className="shrink-0 px-5 pb-2 pt-3">
        <div className={bottomSep} />
        <div className="flex flex-col gap-2" data-testid="example-choices">
          {orderedChoices.map((choice) => {
            const isSelected = selectedTerm === choice.term;
            const isCorrect = choice.term === correctTerm;
            const showCorrect = phase === 'revealed' && isCorrect;
            const showWrong = phase === 'revealed' && isSelected && !isCorrect;

            return (
              <Button
                key={choice.id}
                variant="outline"
                className={cn(
                  'h-12 w-full rounded-lg text-base font-medium transition-colors',
                  phase === 'revealed' && !isCorrect && !isSelected && 'opacity-60',
                  showCorrect && 'border-emerald-500/60 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/10',
                  showWrong && 'border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/10',
                )}
                onClick={() => handleSelect(choice.term)}
                disabled={phase === 'revealed'}
                data-testid={choice.id}
              >
                {choice.term}
              </Button>
            );
          })}
          {phase === 'revealed' && (
            <Button
              className="mt-2 h-12 w-full rounded-lg text-base font-semibold"
              onClick={handleNext}
              data-testid="example-next"
            >
              {t.common.next}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function renderMasked(text: string, reveal: string | null) {
  const parts = text.split(BLANK_PLACEHOLDER);
  if (parts.length === 1) return text;
  const fragments: React.ReactNode[] = [];
  parts.forEach((part, idx) => {
    fragments.push(<span key={`p${idx}`}>{part}</span>);
    if (idx < parts.length - 1) {
      fragments.push(
        <span
          key={`b${idx}`}
          className={cn(
            'mx-1 inline-block min-w-[3em] border-b-2 text-center',
            reveal ? 'border-primary text-primary dark:text-accent-muted' : 'border-text-tertiary text-text-tertiary',
          )}
        >
          {reveal ?? '\u00a0'}
        </span>,
      );
    }
  });
  return fragments;
}

/**
 * Stable shuffle keyed by a seed string — same seed → same order.
 * Used to keep choice order stable across re-renders within a card.
 */
function useStableShuffle<T>(items: T[], seed: string): T[] {
  const [ordered] = useState(() => {
    const out = [...items];
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) {
      h = Math.imul(31, h) + seed.charCodeAt(i);
    }
    // Fisher-Yates with seeded rng
    let s = Math.abs(h) || 1;
    const rng = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  });
  return ordered;
}
