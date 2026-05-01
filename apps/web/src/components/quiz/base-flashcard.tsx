'use client';

import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BookOpen } from '@/components/ui/icons';
import { KanjiText } from '@/components/kanji/kanji-text';
import { useTranslation } from '@/lib/i18n';
import { bottomSep, sectionLabel } from '@/lib/styles';
import { cn } from '@/lib/utils';
import type { Word, WordExample } from '@/types/word';
import type { CardDirection } from '@/types/quiz';

interface BaseFlashcardProps {
  word?: Word;
  examples?: WordExample[];
  progress: { current: number; total: number };
  isLoading?: boolean;
  cardDirection?: CardDirection;
  renderActions: (props: { word: Word; onAdvance: () => void; revealed: boolean }) => ReactNode;
  renderLoadingActions: () => ReactNode;
  testId?: string;
}

/** Resolve 'random' once per card mount */
function useResolvedDirection(direction: CardDirection): 'term_first' | 'meaning_first' {
  const [resolved] = useState<'term_first' | 'meaning_first'>(() =>
    direction === 'random'
      ? (Math.random() < 0.5 ? 'term_first' : 'meaning_first')
      : direction,
  );
  return direction === 'random' ? resolved : direction;
}

function ExampleRow({ example }: { example: WordExample }) {
  const [revealed, setRevealed] = useState(false);
  const toggle = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    setRevealed((v) => !v);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle(e);
        }
      }}
      className="flex cursor-pointer flex-col gap-1 rounded-lg bg-secondary p-3 text-left"
    >
      <div className="text-body font-medium">
        <KanjiText text={example.sentenceJa} />
      </div>
      {example.sentenceReading && (
        <div
          className={cn(
            'text-reading text-text-secondary transition-[opacity,filter] duration-300 ease-out',
            revealed ? 'opacity-100 blur-0' : 'opacity-60 blur-[3px] select-none',
          )}
        >
          {example.sentenceReading}
        </div>
      )}
      {example.sentenceMeaning && (
        <div
          className={cn(
            'text-caption text-primary dark:text-accent-muted transition-[opacity,filter] duration-300 ease-out',
            revealed ? 'opacity-100 blur-0' : 'opacity-60 blur-[3px] select-none',
          )}
        >
          {example.sentenceMeaning}
        </div>
      )}
    </div>
  );
}

export function BaseFlashcard({
  word,
  examples,
  progress,
  isLoading = false,
  cardDirection = 'term_first',
  renderActions,
  renderLoadingActions,
  testId = 'flashcard',
}: BaseFlashcardProps) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const [examplesShown, setExamplesShown] = useState(false);
  const dir = useResolvedDirection(cardDirection);

  useEffect(() => {
    if (!revealed) setExamplesShown(false);
  }, [revealed]);

  const pct = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="h-[3px] w-full bg-secondary" />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-10 w-48 rounded" />
          <Skeleton className="mt-2 h-5 w-32 rounded" />
        </div>
        <div className="shrink-0 px-5 pb-2 pt-3">
          <div className={bottomSep} />
          {renderLoadingActions()}
        </div>
      </div>
    );
  }

  if (!word) {
    return null;
  }

  const isTermFirst = dir === 'term_first';
  const frontText = isTermFirst ? word.term : word.meaning;
  const backPrimary = isTermFirst ? word.meaning : word.term;
  const backReading = isTermFirst ? word.reading : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Progress bar */}
      <div className="h-[3px] w-full bg-secondary">
        <div
          className="h-full bg-primary transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Tap zone */}
      <div
        className="animate-card-enter min-h-0 flex-1 cursor-pointer overflow-y-auto px-4"
        onClick={() => setRevealed((v) => !v)}
        data-testid={testId}
      >
        <div className="flex min-h-full flex-col items-center justify-center gap-3 py-8 text-center">
          {/* Front text */}
          <div className={isTermFirst ? 'text-display font-medium leading-tight' : 'text-2xl font-medium md:text-3xl'}>
            {isTermFirst ? <KanjiText text={frontText} /> : frontText}
          </div>

          {/* Reading — shown when revealed */}
          {revealed && backReading ? (
            <div className="animate-fade-in text-reading text-text-secondary">
              {backReading}
            </div>
          ) : null}

          {/* Back content */}
          {revealed ? (
            <>
              <div className={isTermFirst
                ? 'animate-reveal-up text-subtitle font-semibold text-primary dark:text-accent-muted'
                : 'animate-reveal-up text-3xl font-bold text-primary dark:text-accent-muted md:text-4xl'
              }>
                {isTermFirst ? backPrimary : <KanjiText text={backPrimary} />}
              </div>
              {word.notes && (
                <div
                  className="animate-reveal-up text-sm text-muted-foreground"
                  style={{ animationDelay: '100ms' }}
                >
                  {word.notes}
                </div>
              )}

              {examples && examples.length > 0 && (
                <div
                  className="animate-reveal-up mt-4 flex w-full max-w-md flex-col gap-2"
                  style={{ animationDelay: '200ms' }}
                >
                  {examplesShown ? (
                    <>
                      <div className={cn(sectionLabel, 'text-left')}>{t.wordDetail.examples}</div>
                      {examples.map((ex) => (
                        <ExampleRow key={ex.id} example={ex} />
                      ))}
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExamplesShown(true);
                      }}
                      data-testid="flashcard-show-examples"
                    >
                      <BookOpen className="size-4" />
                      {t.quiz.showExamples}
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-text-tertiary">
              {t.quiz.tapToReveal}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 px-5 pb-2 pt-3">
        <div className={bottomSep} />
        <div className="flex flex-col gap-3">
          {renderActions({ word, onAdvance: () => setRevealed(false), revealed })}
        </div>
      </div>
    </div>
  );
}
