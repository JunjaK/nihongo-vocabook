'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BookOpen, FileImage } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { Button } from '@/components/ui/button';
import { SwipeableWordCard } from '@/components/word/swipeable-word-card';
import { AddToWordbookDialog } from '@/components/wordbook/add-to-wordbook-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';
import {
  pageWrapper,
  bottomBar,
  bottomSep,
  skeletonWordList,
  emptyState,
  emptyIcon,
} from '@/lib/styles';
import type { Word } from '@/types/word';
import type { WordSortOrder } from '@/lib/repository/types';

const PAGE_SIZE = 100;

export default function WordsPage() {
  const repo = useRepository();
  const authLoading = useAuthStore((s) => s.loading);
  const { t } = useTranslation();
  const [words, setWords] = useState<Word[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [wordbookDialogWordId, setWordbookDialogWordId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<WordSortOrder>('priority');
  const loadStart = useRef(0);
  const initialLoaded = useRef(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const hasMore = words.length < totalCount;

  const loadWords = useCallback(async () => {
    if (authLoading) return;

    setLoading(true);
    loadStart.current = Date.now();
    try {
      if (appliedQuery) {
        const data = await repo.words.search(appliedQuery);
        const filtered = data.filter((w) => !w.mastered);
        setWords(filtered);
        setTotalCount(filtered.length);
      } else {
        const result = await repo.words.getNonMasteredPaginated({
          sort: sortOrder,
          limit: PAGE_SIZE,
          offset: 0,
        });
        setWords(result.words);
        setTotalCount(result.totalCount);
      }
    } finally {
      const remaining = 300 - (Date.now() - loadStart.current);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      initialLoaded.current = true;
      setLoading(false);
    }
  }, [repo, appliedQuery, sortOrder, authLoading]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || appliedQuery) return;
    setLoadingMore(true);
    try {
      const result = await repo.words.getNonMasteredPaginated({
        sort: sortOrder,
        limit: PAGE_SIZE,
        offset: words.length,
      });
      setWords((prev) => [...prev, ...result.words]);
      setTotalCount(result.totalCount);
    } finally {
      setLoadingMore(false);
    }
  }, [repo, sortOrder, words.length, loadingMore, hasMore, appliedQuery]);

  // Infinite scroll: load more when near bottom
  const handleScroll = useCallback(() => {
    if (!parentRef.current || !hasMore || loadingMore || appliedQuery) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    if (scrollHeight - scrollTop - clientHeight < 300) {
      loadMore();
    }
  }, [hasMore, loadingMore, appliedQuery, loadMore]);

  const handleSearch = () => {
    setAppliedQuery(searchInput.trim());
  };

  const handleSearchClear = () => {
    setSearchInput('');
    setAppliedQuery('');
  };

  const handleSortChange = (v: string) => {
    setSortOrder(v as WordSortOrder);
  };

  const sortOptions = [
    { value: 'priority', label: t.priority.sortByPriority },
    { value: 'newest', label: t.priority.sortByNewest },
    { value: 'alphabetical', label: t.priority.sortByAlphabetical },
  ];

  const virtualizer = useVirtualizer({
    count: words.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  const handleMaster = async (wordId: string) => {
    await repo.words.setMastered(wordId, true);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    setTotalCount((prev) => prev - 1);
    invalidateListCache('mastered');
  };

  return (
    <div className={pageWrapper}>
      <Header
        title={t.words.title}
        desc={!loading && totalCount > 0 ? t.words.totalWordCount(totalCount) : undefined}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/words/scan">
              <Button variant="ghost" size="icon-sm" data-testid="words-scan-button" aria-label="Scan">
                <FileImage className="size-5" />
              </Button>
            </Link>
          </div>
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
        onSortChange={handleSortChange}
      />

      {(loading || !initialLoaded.current) ? (
        <div className={skeletonWordList}>
          {Array.from({ length: 20 }).map((_, i) => (
            <Skeleton key={i} className="h-[60px] w-full rounded-lg" />
          ))}
        </div>
      ) : words.length === 0 ? (
        <div className={emptyState}>
          <BookOpen className={emptyIcon} />
          {appliedQuery ? t.words.noWords : (
            <>
              <div className="font-medium">{t.words.noWordsYet}</div>
              <div className="mt-1 text-sm">{t.words.noWordsYetHint}</div>
            </>
          )}
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
          <div
            className="relative px-4 pt-2 pb-2"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vr) => {
              const word = words[vr.index];
              return (
                <div
                  key={word.id}
                  ref={virtualizer.measureElement}
                  data-index={vr.index}
                  className="absolute left-4 right-4 pb-2"
                  style={{ transform: `translateY(${vr.start}px)` }}
                >
                  <SwipeableWordCard
                    word={word}
                    showReading={showReading}
                    showMeaning={showMeaning}
                    onSwipeAction={handleMaster}
                    swipeLabel={t.wordDetail.markMastered}
                    swipeColor="green"
                    contextMenuActions={[
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
          {loadingMore && (
            <div className="flex justify-center py-4">
              <div className="text-sm text-muted-foreground">{t.common.loading}</div>
            </div>
          )}
        </div>
      )}

      <div className={bottomBar}>
        <div className={bottomSep} />
        <div className="flex gap-2">
          <Link href="/quiz?quickStart=1" className="flex-1">
            <Button
              variant="outline"
              className="w-full"
              disabled={loading || totalCount === 0}
              data-testid="words-start-quiz-button"
            >
              {t.words.startQuiz}
            </Button>
          </Link>
          <Link href="/words/create" className="flex-1">
            <Button className="w-full" disabled={loading} data-testid="words-add-button">
              {t.words.addWord}
            </Button>
          </Link>
        </div>
      </div>

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
