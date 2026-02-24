'use client';

import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Flag, Trash2 } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { SwipeableWordCard } from '@/components/word/swipeable-word-card';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { useSearch } from '@/hooks/use-search';
import { invalidateListCache } from '@/lib/list-cache';
import { requestDueCountRefresh } from '@/lib/quiz/due-count-sync';
import {
  skeletonWordList,
  emptyState,
  emptyIcon,
} from '@/lib/styles';
import type { Word } from '@/types/word';
import type { WordSortOrder } from '@/lib/repository/types';

const PAGE_SIZE = 100;

export default function MasteredPage() {
  const repo = useRepository();
  const authLoading = useAuthStore((s) => s.loading);
  const { t } = useTranslation();
  const [words, setWords] = useState<Word[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [sortOrder, setSortOrder] = useState<WordSortOrder>('newest');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const loadGenRef = useRef(0);

  const { searchInput, appliedQuery, setSearchInput, handleSearch, handleSearchClear } = useSearch();

  const hasMore = words.length < totalCount;

  const [loading] = useLoader(async () => {
    loadGenRef.current += 1;
    if (appliedQuery) {
      const data = await repo.words.getMastered();
      const lower = appliedQuery.toLowerCase();
      const filtered = data.filter(
        (w) =>
          w.term.toLowerCase().includes(lower) ||
          w.reading.toLowerCase().includes(lower) ||
          w.meaning.toLowerCase().includes(lower),
      );
      setWords(filtered);
      setTotalCount(filtered.length);
    } else {
      const result = await repo.words.getMasteredPaginated({
        sort: sortOrder,
        limit: PAGE_SIZE,
        offset: 0,
      });
      setWords(result.words);
      setTotalCount(result.totalCount);
    }
  }, [repo, appliedQuery, sortOrder], { skip: authLoading });

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || appliedQuery) return;
    const gen = loadGenRef.current;
    setLoadingMore(true);
    try {
      const result = await repo.words.getMasteredPaginated({
        sort: sortOrder,
        limit: PAGE_SIZE,
        offset: words.length,
      });
      if (gen !== loadGenRef.current) return;
      setWords((prev) => [...prev, ...result.words]);
      setTotalCount(result.totalCount);
    } finally {
      setLoadingMore(false);
    }
  }, [repo, sortOrder, words.length, loadingMore, hasMore, appliedQuery]);

  const handleScroll = useCallback(() => {
    if (!parentRef.current || !hasMore || loadingMore || appliedQuery) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    if (scrollHeight - scrollTop - clientHeight < 300) {
      loadMore();
    }
  }, [hasMore, loadingMore, appliedQuery, loadMore]);

  const virtualizer = useVirtualizer({
    count: words.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  const handleUnmaster = async (wordId: string) => {
    await repo.words.setMastered(wordId, false);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    setTotalCount((prev) => prev - 1);
    invalidateListCache('words');
    invalidateListCache('wordbooks');
    requestDueCountRefresh();
  };

  const handleDeleteRequest = (wordId: string) => {
    setDeleteTarget(wordId);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await repo.words.delete(deleteTarget);
    setWords((prev) => prev.filter((w) => w.id !== deleteTarget));
    setTotalCount((prev) => prev - 1);
    invalidateListCache('words');
    invalidateListCache('wordbooks');
    setDeleteTarget(null);
    toast.success(t.words.wordDeleted);
  };

  return (
    <>
      <Header
        title={t.masteredPage.title}
        desc={!loading && totalCount > 0 ? t.words.totalWordCount(totalCount) : undefined}
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
        sortOptions={[
          { value: 'priority', label: t.priority.sortByPriority },
          { value: 'newest', label: t.priority.sortByNewest },
          { value: 'alphabetical', label: t.priority.sortByAlphabetical },
        ]}
        onSortChange={(v) => setSortOrder(v as WordSortOrder)}
      />

      {loading ? (
        <div className={skeletonWordList}>
          {Array.from({ length: 20 }).map((_, i) => (
            <Skeleton key={i} className="h-[60px] w-full rounded-lg" />
          ))}
        </div>
      ) : words.length === 0 ? (
        <div className={emptyState}>
          <Flag className={emptyIcon} />
          {appliedQuery ? t.words.noWords : t.masteredPage.noWords}
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
                    onSwipeAction={handleUnmaster}
                    swipeLabel={t.masteredPage.unmaster}
                    swipeColor="orange"
                    contextMenuActions={[
                      {
                        label: t.masteredPage.unmaster,
                        onAction: handleUnmaster,
                      },
                      {
                        label: t.common.delete,
                        onAction: handleDeleteRequest,
                        variant: 'destructive',
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

      <ConfirmDialog
        open={deleteTarget !== null}
        icon={<Trash2 className="text-destructive" />}
        title={t.common.delete}
        description={t.words.deleteConfirm}
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
