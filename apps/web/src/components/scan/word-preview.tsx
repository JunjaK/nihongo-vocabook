'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, SearchX } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { bottomBar, bottomSep, emptyState, emptyIcon } from '@/lib/styles';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';

interface WordPreviewProps {
  words: ExtractedWord[];
  userJlptLevel?: number | null;
  existingTerms?: Set<string>;
  onConfirm: (selectedWords: ExtractedWord[]) => Promise<void>;
  onEditAndAdd?: (selectedWords: ExtractedWord[]) => void;
  onRetry: () => void;
  /** Dismiss the scan results without adding. */
  onDiscard?: () => void;
}

function getDefaultChecked(
  words: ExtractedWord[],
  userJlptLevel: number | null | undefined,
  existingTerms: Set<string>,
): boolean[] {
  return words.map((w) => {
    // Existing words are always unchecked
    if (existingTerms.has(w.term)) return false;
    // Apply JLPT filter if available
    if (userJlptLevel) return w.jlptLevel === null || w.jlptLevel <= userJlptLevel;
    return true;
  });
}

function isSameSelection(a: boolean[], b: boolean[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getSelectionMode(
  checked: boolean[],
  words: ExtractedWord[],
  userJlptLevel: number | null | undefined,
  existingTerms: Set<string>,
): 'all' | 'level' | 'none' | 'custom' {
  const allSelected = words.map((w) => !existingTerms.has(w.term));
  if (isSameSelection(checked, allSelected)) return 'all';

  const noneSelected = Array(words.length).fill(false);
  if (isSameSelection(checked, noneSelected)) return 'none';

  if (userJlptLevel) {
    const levelSelected = words.map((w) => {
      if (existingTerms.has(w.term)) return false;
      return w.jlptLevel === null || w.jlptLevel <= userJlptLevel;
    });
    if (isSameSelection(checked, levelSelected)) return 'level';
  }

  return 'custom';
}

export function WordPreview({
  words,
  userJlptLevel,
  existingTerms = new Set(),
  onConfirm,
  onEditAndAdd,
  onRetry,
  onDiscard,
}: WordPreviewProps) {
  const { t } = useTranslation();
  const wordCount = words.length;
  const interactedRef = useRef(false);
  const [checked, setChecked] = useState<boolean[]>(() =>
    getDefaultChecked(words, userJlptLevel, existingTerms),
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const defaults = getDefaultChecked(words, userJlptLevel, existingTerms);
    setChecked((prev) => {
      // Keep first-render default behavior aligned with latest existingTerms/user level.
      if (!interactedRef.current || prev.length !== defaults.length) return defaults;
      // After user interaction, preserve manual choices but always force existing words to unchecked.
      return words.map((w, i) => (existingTerms.has(w.term) ? false : Boolean(prev[i])));
    });
  }, [words, userJlptLevel, existingTerms]);

  if (wordCount === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={emptyState}>
          <SearchX className={emptyIcon} />
          <div className="font-medium">{t.scan.noWordsFound}</div>
        </div>
        <div className={bottomBar}>
          <div className={bottomSep} />
          <Button className="w-full" variant="outline" onClick={onRetry} data-testid="scan-retry">
            {t.scan.retry}
          </Button>
        </div>
      </div>
    );
  }

  const newCount = words.filter((w) => !existingTerms.has(w.term)).length;
  const existingCount = wordCount - newCount;
  const selectedCount = checked.filter(Boolean).length;
  const selectionMode = getSelectionMode(checked, words, userJlptLevel, existingTerms);

  const selectAll = () => {
    interactedRef.current = true;
    const allSelection = words.map((w) => !existingTerms.has(w.term));
    setChecked(allSelection);
    if (!allSelection.some(Boolean)) {
      toast.info(t.scan.noSelectableWords);
    }
  };

  const filterByLevel = () => {
    if (!userJlptLevel) return;
    interactedRef.current = true;
    const levelSelection = words.map((w) => {
      if (existingTerms.has(w.term)) return false;
      return w.jlptLevel === null || w.jlptLevel <= userJlptLevel;
    });
    setChecked(levelSelection);
    if (!levelSelection.some(Boolean)) {
      toast.info(t.scan.noWordsForLevel);
    }
  };

  const deselectAll = () => {
    interactedRef.current = true;
    setChecked(Array(wordCount).fill(false));
  };

  const toggle = (i: number) => {
    // Existing words cannot be toggled
    if (existingTerms.has(words[i].term)) return;
    interactedRef.current = true;
    setChecked((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  };

  const getSelectedWords = () =>
    checked
      .map((c, i) => (c ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => words[i]);

  const handleConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      await onConfirm(getSelectedWords());
    } finally {
      setConfirming(false);
    }
  };
  const handleEditAndAdd = () => onEditAndAdd?.(getSelectedWords());

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Sticky selection toolbar */}
      <div className="animate-slide-down-fade sticky top-14 z-9 bg-background">
        <div className="flex items-center justify-between px-5 py-2">
          {/* Selection count */}
          <div className="flex shrink-0 items-center gap-1.5 text-sm font-semibold">
            <Check className="size-icon text-primary" />
            <span className="tabular-nums">{selectedCount} / {newCount}</span>
          </div>

          {/* Selection actions */}
          <div className="flex gap-1">
            <button
              type="button"
              className={cn(
                'h-[30px] rounded-md border px-2.5 text-[11px] font-medium transition-colors',
                selectionMode === 'all'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground',
              )}
              onClick={selectAll}
              data-testid="scan-select-all"
            >
              {t.scan.selectAll}
            </button>
            {userJlptLevel && (
              <button
                type="button"
                className={cn(
                  'h-[30px] rounded-md border px-2.5 text-[11px] font-medium transition-colors',
                  selectionMode === 'level'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground',
                )}
                onClick={filterByLevel}
                data-testid="scan-filter-by-level"
              >
                {t.scan.filterByLevel}
              </button>
            )}
            <button
              type="button"
              className={cn(
                'h-[30px] rounded-md border px-2.5 text-[11px] font-medium transition-colors',
                selectionMode === 'none'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground',
              )}
              onClick={deselectAll}
              data-testid="scan-deselect-all"
            >
              {t.scan.deselectAll}
            </button>
          </div>
        </div>
        {existingCount > 0 && (
          <div className="px-5 pb-2 text-xs text-text-tertiary">
            {t.scan.alreadyRegistered(existingCount)}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div>
          {words.map((word, i) => {
            const isExisting = existingTerms.has(word.term);
            const isChecked = checked[i];
            return (
              <div
                key={i}
                role="checkbox"
                aria-checked={isChecked}
                aria-disabled={isExisting}
                tabIndex={isExisting ? -1 : 0}
                className={`animate-stagger flex items-center gap-3 border-b border-border px-5 py-3 transition-colors ${
                  isExisting
                    ? 'opacity-40'
                    : isChecked
                      ? 'cursor-pointer bg-accent-muted/10'
                      : 'cursor-pointer opacity-60'
                }`}
                style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
                onClick={() => toggle(i)}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(i); } }}
              >
                <div
                  className={`flex size-[22px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                    isExisting
                      ? 'border-muted-foreground/20 bg-muted'
                      : isChecked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border-strong'
                  }`}
                >
                  {isChecked && <Check className="size-3.5" strokeWidth={3} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-bold">
                    <span className="shrink-0">{word.term}</span>
                    {word.reading ? (
                      <span className="shrink-0 text-sm font-normal text-muted-foreground">
                        {word.reading}
                      </span>
                    ) : null}
                    {isExisting && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {t.scan.alreadyAdded}
                      </span>
                    )}
                    {/* Surface dictionary auto-correction so the user can see
                        when the displayed form differs from the model's raw
                        output (inflection normalized, compound split, etc.). */}
                    {word.matchSource === 'inflection' ||
                    word.matchSource === 'reading' ||
                    word.matchSource === 'split' ? (
                      <span
                        className="shrink-0 rounded bg-accent-muted/20 px-1.5 py-0.5 text-xs font-normal text-text-tertiary"
                        title={word.matchSource}
                      >
                        {t.scan.autoCorrected}
                      </span>
                    ) : null}
                    {word.jlptLevel && (
                      <span className="ml-auto shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                        N{word.jlptLevel}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {word.meaning || (
                      <span className="italic">{t.scan.notFound}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={bottomBar}>
        <div className={bottomSep} />
        <div className="flex gap-2">
          {onDiscard && (
            <Button
              className="shrink-0 px-3 text-muted-foreground"
              variant="outline"
              disabled={confirming}
              onClick={onDiscard}
              data-testid="scan-discard"
            >
              {t.scan.discard}
            </Button>
          )}
          {onEditAndAdd && (
            <Button
              className="min-w-0 flex-1 basis-0"
              variant="outline"
              disabled={selectedCount === 0 || confirming}
              onClick={handleEditAndAdd}
              data-testid="scan-edit-and-add"
            >
              {t.scan.editAndAdd}
            </Button>
          )}
          <Button
            className="min-w-0 flex-1 basis-0"
            disabled={selectedCount === 0 || confirming}
            onClick={handleConfirm}
            data-testid="scan-confirm-selected"
          >
            {confirming ? (
              <LoadingSpinner className="size-4" />
            ) : (
              <>{t.scan.addSelected} ({selectedCount})</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
