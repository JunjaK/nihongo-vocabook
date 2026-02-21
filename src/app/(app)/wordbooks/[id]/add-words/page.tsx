'use client';

import { useState, useEffect, useCallback, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { Word } from '@/types/word';

export default function AddWordsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const { t } = useTranslation();

  const [allWords, setAllWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);

  const loadWords = useCallback(async () => {
    setLoading(true);
    try {
      const [nonMastered, wordbookWords] = await Promise.all([
        repo.words.getNonMastered(),
        repo.wordbooks.getWords(id),
      ]);
      const existingIds = new Set(wordbookWords.map((w) => w.id));
      setAllWords(nonMastered.filter((w) => !existingIds.has(w.id)));
    } finally {
      setLoading(false);
    }
  }, [repo, id]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  const handleSearch = () => {
    setAppliedQuery(searchInput.trim());
  };

  const handleSearchClear = () => {
    setSearchInput('');
    setAppliedQuery('');
  };

  const filteredWords = appliedQuery
    ? allWords.filter((w) => {
        const lower = appliedQuery.toLowerCase();
        return (
          w.term.toLowerCase().includes(lower) ||
          w.reading.toLowerCase().includes(lower) ||
          w.meaning.toLowerCase().includes(lower)
        );
      })
    : allWords;

  const virtualizer = useVirtualizer({
    count: filteredWords.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

  const toggleWord = (wordId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(wordId)) {
        next.delete(wordId);
      } else {
        next.add(wordId);
      }
      return next;
    });
  };

  const handleAdd = async () => {
    if (selectedIds.size === 0) return;
    setAdding(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((wordId) => repo.wordbooks.addWord(id, wordId)),
      );
      toast.success(t.wordbooks.addNWords(selectedIds.size));
      router.back();
    } catch {
      toast.error(t.common.saving);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header title={t.wordbooks.addWords} showBack />

      <div className="shrink-0 px-4 pt-3 pb-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 pr-16"
            placeholder={t.words.searchPlaceholder}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            data-testid="add-words-search-input"
          />
          {searchInput && (
            <button
              type="button"
              className="absolute top-1/2 right-10 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleSearchClear}
            >
              {t.common.clear}
            </button>
          )}
          <button
            type="button"
            className="absolute top-1/2 right-3 -translate-y-1/2 text-sm font-medium text-primary"
            onClick={handleSearch}
          >
            {t.common.search}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t.wordbooks.selectWords}</p>
      </div>

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner className="size-8" />
          {t.common.loading}
        </div>
      ) : filteredWords.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          {t.words.noWords}
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto">
          <div
            className="relative px-4"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vr) => {
              const word = filteredWords[vr.index];
              const isSelected = selectedIds.has(word.id);
              return (
                <div
                  key={word.id}
                  className="absolute left-4 right-4"
                  style={{ height: vr.size, transform: `translateY(${vr.start}px)` }}
                >
                  <button
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:bg-accent/50'
                    }`}
                    onClick={() => toggleWord(word.id)}
                    data-testid={`add-words-item-${vr.index}`}
                  >
                    <div
                      className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/30'
                      }`}
                    >
                      {isSelected && (
                        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{word.term}</span>
                      <span className="ml-2 text-sm text-muted-foreground">{word.reading}</span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{word.meaning}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="shrink-0 bg-background px-4 pb-3">
        <div className="mb-3 h-px bg-border" />
        <Button
          className="w-full"
          disabled={selectedIds.size === 0 || adding}
          onClick={handleAdd}
          data-testid="add-words-confirm-button"
        >
          {adding ? t.common.saving : t.wordbooks.addNWords(selectedIds.size)}
        </Button>
      </div>
    </div>
  );
}
