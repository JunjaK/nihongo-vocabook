'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';

interface WordPreviewProps {
  words: ExtractedWord[];
  userJlptLevel?: number | null;
  onConfirm: (selectedWords: ExtractedWord[]) => void;
  onRetry: () => void;
}

export function WordPreview({
  words,
  userJlptLevel,
  onConfirm,
  onRetry,
}: WordPreviewProps) {
  const { t } = useTranslation();
  const wordCount = words.length;
  const [checked, setChecked] = useState<boolean[]>(() =>
    userJlptLevel
      ? words.map((w) => w.jlptLevel === null || w.jlptLevel <= userJlptLevel)
      : Array(wordCount).fill(true),
  );

  if (wordCount === 0) {
    return (
      <div className="animate-page space-y-4 p-4 text-center">
        <div className="py-8 text-muted-foreground">{t.scan.noWordsFound}</div>
        <Button variant="outline" onClick={onRetry} data-testid="scan-retry">
          {t.scan.retry}
        </Button>
      </div>
    );
  }

  const selectedCount = checked.filter(Boolean).length;

  const selectAll = () => setChecked(Array(wordCount).fill(true));
  const deselectAll = () => setChecked(Array(wordCount).fill(false));

  const filterByLevel = () => {
    if (!userJlptLevel) return;
    setChecked(
      words.map((w) => w.jlptLevel === null || w.jlptLevel <= userJlptLevel),
    );
  };

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  };

  const handleConfirm = () => {
    const selected = checked
      .map((c, i) => (c ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => words[i]);
    onConfirm(selected);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky selection toolbar — matches ListToolbar pattern */}
      <div className="animate-slide-down-fade sticky top-14 z-[9] bg-background">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="text-sm text-muted-foreground">
            {t.scan.extractedCount(wordCount)}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={selectAll}
              data-testid="scan-select-all"
            >
              {t.scan.selectAll}
            </Button>
            {userJlptLevel && (
              <Button
                variant="ghost"
                size="xs"
                onClick={filterByLevel}
                data-testid="scan-filter-by-level"
              >
                {t.scan.filterByLevel}
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={deselectAll}
              data-testid="scan-deselect-all"
            >
              {t.scan.deselectAll}
            </Button>
          </div>
        </div>
        <div className="mx-4 h-px bg-border" />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-1">
          {words.map((word, i) => (
            <label
              key={i}
              className="animate-stagger flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
              style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
            >
              <input
                type="checkbox"
                checked={checked[i]}
                onChange={() => toggle(i)}
                className="size-4 rounded border-gray-300"
                data-testid={`scan-word-check-${i}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-bold">
                  {word.term}
                  {word.reading ? (
                    <span className="text-sm font-normal text-muted-foreground">
                      {word.reading}
                    </span>
                  ) : null}
                  {word.jlptLevel && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
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
            </label>
          ))}
        </div>
      </div>

      <div className="shrink-0 bg-background px-4 pb-3">
        <div className="mb-3 h-px bg-border" />
        <Button
          className="w-full"
          disabled={selectedCount === 0}
          onClick={handleConfirm}
          data-testid="scan-confirm-selected"
        >
          {t.scan.addSelected} ({selectedCount})
        </Button>
      </div>
    </div>
  );
}
