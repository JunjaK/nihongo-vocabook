'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { useLoader } from '@/hooks/use-loader';
import { useSearch } from '@/hooks/use-search';
import { getListCache, setListCache } from '@/lib/list-cache';
import { markWordMastered } from '@/lib/actions/mark-mastered';
import { PAGE_SIZE, getWordSortOptions } from '@/lib/constants';
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

interface WordsCacheData {
  words: Word[];
  totalCount: number;
  sortOrder: WordSortOrder;
}

export default function WordsPage() {
  const router = useRouter();
  const repo = useRepository();
  const authLoading = useAuthStore((s) => s.loading);
  const { t } = useTranslation();
  const [words, setWords] = useState<Word[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [wordbookDialogWordId, setWordbookDialogWordId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<WordSortOrder>(() => {
    const cached = getListCache<WordsCacheData>('words');
    return cached?.data.sortOrder ?? 'priority';
  });
  const parentRef = useRef<HTMLDivElement>(null);
  const loadGenRef = useRef(0); // generation counter to cancel stale loadMore
  const scrollOffsetRef = useRef(0);
  const pendingScrollRef = useRef<number | null>(null);

  const { searchInput, appliedQuery, setSearchInput, handleSearch, handleSearchClear } = useSearch();

  const hasMore = words.length < totalCount;

  // Keep a ref that always reflects the latest state so the unmount cleanup
  // can save the correct data without stale closure issues.
  const cacheRef = useRef({ words: [] as Word[], totalCount: 0, sortOrder: 'priority' as WordSortOrder, appliedQuery: '' });
  cacheRef.current = { words, totalCount, sortOrder, appliedQuery };

  // Save list data + scroll offset to cache on unmount
  useEffect(() => {
    return () => {
      const { words: w, totalCount: tc, sortOrder: so, appliedQuery: aq } = cacheRef.current;
      if (w.length > 0 && !aq) {
        setListCache('words', { words: w, totalCount: tc, sortOrder: so }, scrollOffsetRef.current);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [loading] = useLoader(async () => {
    loadGenRef.current += 1; // invalidate in-flight loadMore
    if (appliedQuery) {
      const data = await repo.words.search(appliedQuery);
      setWords(data);
      setTotalCount(data.length);
    } else {
      // Try restoring from cache (e.g. back-navigation from detail page)
      const cached = getListCache<WordsCacheData>('words');
      if (cached && cached.data.sortOrder === sortOrder) {
        setWords(cached.data.words);
        setTotalCount(cached.data.totalCount);
        pendingScrollRef.current = cached.scrollOffset;
        return true; // skip minimum delay — data from cache
      }
      const result = await repo.words.getNonMasteredPaginated({
        sort: sortOrder,
        limit: PAGE_SIZE,
        offset: 0,
      });
      setWords(result.words);
      setTotalCount(result.totalCount);
    }
  }, [repo, appliedQuery, sortOrder], { skip: authLoading });

  // Restore scroll position after cache-based render
  useEffect(() => {
    if (!loading && pendingScrollRef.current !== null && parentRef.current) {
      const scrollTo = pendingScrollRef.current;
      pendingScrollRef.current = null;
      requestAnimationFrame(() => {
        if (parentRef.current) {
          parentRef.current.scrollTop = scrollTo;
        }
      });
    }
  }, [loading]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || appliedQuery) return;
    const gen = loadGenRef.current;
    setLoadingMore(true);
    try {
      const result = await repo.words.getNonMasteredPaginated({
        sort: sortOrder,
        limit: PAGE_SIZE,
        offset: words.length,
      });
      // Discard result if sort/query changed while this was in-flight
      if (gen !== loadGenRef.current) return;
      setWords((prev) => [...prev, ...result.words]);
      setTotalCount(result.totalCount);
    } finally {
      setLoadingMore(false);
    }
  }, [repo, sortOrder, words.length, loadingMore, hasMore, appliedQuery]);

  // Infinite scroll: load more when near bottom
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    scrollOffsetRef.current = parentRef.current.scrollTop;
    if (!hasMore || loadingMore || appliedQuery) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    if (scrollHeight - scrollTop - clientHeight < 300) {
      loadMore();
    }
  }, [hasMore, loadingMore, appliedQuery, loadMore]);

  const handleSortChange = (v: string) => {
    setSortOrder(v as WordSortOrder);
  };

  const sortOptions = getWordSortOptions(t);

  const virtualizer = useVirtualizer({
    count: words.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  const handleMaster = async (wordId: string) => {
    // Optimistic: remove from list immediately
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    setTotalCount((prev) => prev - 1);
    await markWordMastered(repo, wordId);
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

      {loading ? (
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
          {loading || totalCount === 0 ? (
            <Button variant="outline" className="flex-1" disabled data-testid="words-start-quiz-button">
              {t.words.startQuiz}
            </Button>
          ) : (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.location.assign('/quiz?quickStart=1')}
              data-testid="words-start-quiz-button"
            >
              {t.words.startQuiz}
            </Button>
          )}
          {loading ? (
            <Button className="flex-1" disabled data-testid="words-add-button">
              {t.words.addWord}
            </Button>
          ) : (
            <Link href="/words/create" className="flex-1">
              <Button className="w-full" data-testid="words-add-button">
                {t.words.addWord}
              </Button>
            </Link>
          )}
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
