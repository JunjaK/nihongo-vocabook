'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';

interface OcrPreviewProps {
  mode: 'ocr';
  words: string[];
  onConfirm: (selectedWords: string[]) => void;
  onRetry: () => void;
}

interface LlmPreviewProps {
  mode: 'llm';
  words: ExtractedWord[];
  userJlptLevel?: number | null;
  onConfirm: (selectedWords: ExtractedWord[]) => void;
  onRetry: () => void;
}

type WordPreviewProps = OcrPreviewProps | LlmPreviewProps;

export function WordPreview(props: WordPreviewProps) {
  const { t } = useTranslation();
  const { mode, onRetry } = props;
  const wordCount = props.words.length;
  const [checked, setChecked] = useState<boolean[]>(() =>
    Array(wordCount).fill(true),
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

  const allSelected = checked.every(Boolean);
  const selectedCount = checked.filter(Boolean).length;

  const toggleAll = () => {
    setChecked(Array(wordCount).fill(!allSelected));
  };

  const toggle = (i: number) => {
    setChecked((prev) => {
      const next = [...prev];
      next[i] = !next[i];
      return next;
    });
  };

  const filterByLevel = () => {
    if (mode !== 'llm') return;
    const userLevel = props.userJlptLevel;
    if (!userLevel) return;
    setChecked(
      props.words.map((w) => w.jlptLevel === null || w.jlptLevel >= userLevel),
    );
  };

  const handleConfirm = () => {
    const selectedIndices = checked
      .map((c, i) => (c ? i : -1))
      .filter((i) => i >= 0);

    if (mode === 'ocr') {
      const selected = selectedIndices.map((i) => props.words[i]);
      props.onConfirm(selected);
    } else {
      const selected = selectedIndices.map((i) => props.words[i]);
      props.onConfirm(selected);
    }
  };

  const showFilterButton = mode === 'llm' && props.userJlptLevel;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t.scan.previewTitle}</h2>
          <div className="flex items-center gap-1">
            {showFilterButton && (
              <Button
                variant="ghost"
                size="sm"
                onClick={filterByLevel}
                data-testid="scan-filter-by-level"
              >
                {t.scan.filterByLevel}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleAll}
              data-testid="scan-toggle-all"
            >
              {allSelected ? t.scan.deselectAll : t.scan.selectAll}
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          {mode === 'ocr'
            ? props.words.map((word, i) => (
                <label
                  key={i}
                  className="animate-stagger flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                  style={{ '--stagger': i } as React.CSSProperties}
                >
                  <input
                    type="checkbox"
                    checked={checked[i]}
                    onChange={() => toggle(i)}
                    className="size-4 rounded border-gray-300"
                    data-testid={`scan-word-check-${i}`}
                  />
                  <span className="text-lg">{word}</span>
                </label>
              ))
            : props.words.map((word, i) => (
                <label
                  key={i}
                  className="animate-stagger flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                  style={{ '--stagger': i } as React.CSSProperties}
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
                      <span className="text-sm font-normal text-muted-foreground">
                        {word.reading}
                      </span>
                      {word.jlptLevel && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                          N{word.jlptLevel}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {word.meaning}
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
          {mode === 'ocr' ? t.scan.confirmSelected : t.scan.addSelected} ({selectedCount})
        </Button>
      </div>
    </div>
  );
}
