'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { BookOpen, Camera } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { Button } from '@/components/ui/button';
import { WordCardWithMenu } from '@/components/word/swipeable-word-card';
import { AddToWordbookDialog } from '@/components/wordbook/add-to-wordbook-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { Word } from '@/types/word';

type SortOrder = 'priority' | 'newest' | 'oldest';

function sortWords(words: Word[], order: SortOrder): Word[] {
  return [...words].sort((a, b) => {
    if (order === 'priority') {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.createdAt.getTime() - a.createdAt.getTime();
    }
    if (order === 'newest') return b.createdAt.getTime() - a.createdAt.getTime();
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export default function WordsPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const [words, setWords] = useState<Word[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [wordbookDialogWordId, setWordbookDialogWordId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('priority');
  const loadStart = useRef(0);
  const parentRef = useRef<HTMLDivElement>(null);

  const loadWords = useCallback(async () => {
    setLoading(true);
    loadStart.current = Date.now();
    try {
      if (appliedQuery) {
        const data = await repo.words.search(appliedQuery);
        setWords(data.filter((w) => !w.mastered));
      } else {
        const data = await repo.words.getNonMastered();
        setWords(data);
      }
    } finally {
      const remaining = 300 - (Date.now() - loadStart.current);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      setLoading(false);
    }
  }, [repo, appliedQuery]);

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

  const sortOptions = [
    { value: 'priority', label: t.priority.sortByPriority },
    { value: 'newest', label: t.priority.sortByNewest },
    { value: 'oldest', label: t.priority.sortByOldest },
  ];

  const sortedWords = sortWords(words, sortOrder);

  const virtualizer = useVirtualizer({
    count: sortedWords.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  const handleSetPriority = async (wordId: string, priority: number) => {
    await repo.words.update(wordId, { priority });
    setWords((prev) => prev.map((w) => (w.id === wordId ? { ...w, priority } : w)));
  };

  const handleMaster = async (wordId: string) => {
    await repo.words.setMastered(wordId, true);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    toast.success(t.masteredPage.wordMastered);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        title={t.words.title}
        actions={
          <Link href="/words/scan">
            <Button variant="ghost" size="icon-sm" data-testid="words-scan-button" aria-label="Scan">
              <Camera className="size-5" />
            </Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        onSearchSubmit={handleSearch}
        onSearchClear={handleSearchClear}
        searchPlaceholder={t.words.searchPlaceholder}
        showReading={showReading}
        onToggleReading={() => setShowReading((v) => !v)}
        showMeaning={showMeaning}
        onToggleMeaning={() => setShowMeaning((v) => !v)}
        sortValue={sortOrder}
        sortOptions={sortOptions}
        onSortChange={(v) => setSortOrder(v as SortOrder)}
      />

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner className="size-8" />
          {t.common.loading}
        </div>
      ) : words.length === 0 ? (
        <div className="animate-fade-in flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          <BookOpen className="mb-3 size-10 text-muted-foreground/50" />
          {appliedQuery ? t.words.noWords : t.words.noWordsYet}
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto">
          <div
            className="relative px-4 pt-2 pb-2"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vr) => {
              const word = sortedWords[vr.index];
              return (
                <div
                  key={word.id}
                  className="absolute left-4 right-4 pb-2"
                  style={{ height: vr.size, transform: `translateY(${vr.start}px)` }}
                >
                  <WordCardWithMenu
                    word={word}
                    showReading={showReading}
                    showMeaning={showMeaning}
                    actions={[
                      {
                        label: `${t.priority.title}: ${t.priority.high}`,
                        onAction: (id) => handleSetPriority(id, 1),
                      },
                      {
                        label: `${t.priority.title}: ${t.priority.medium}`,
                        onAction: (id) => handleSetPriority(id, 2),
                      },
                      {
                        label: `${t.priority.title}: ${t.priority.low}`,
                        onAction: (id) => handleSetPriority(id, 3),
                      },
                      {
                        label: t.wordDetail.markMastered,
                        onAction: handleMaster,
                      },
                      {
                        label: t.wordDetail.addToWordbook,
                        onAction: (id) => setWordbookDialogWordId(id),
                      },
                    ]}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && words.length > 0 && (
        <div className="shrink-0 bg-background px-4 pb-3">
          <div className="mb-3 h-px bg-border" />
          <Link href="/words/new">
            <Button className="w-full" data-testid="words-add-button">
              {t.words.addWord}
            </Button>
          </Link>
        </div>
      )}

      {wordbookDialogWordId && (
        <AddToWordbookDialog
          wordId={wordbookDialogWordId}
          open
          onClose={() => setWordbookDialogWordId(null)}
        />
      )}
    </div>
  );
}
