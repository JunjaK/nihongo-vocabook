'use client';

import { useState } from 'react';
import { toast } from 'sonner';
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
import { getListCache, setListCache, invalidateListCache } from '@/lib/list-cache';
import {
  skeletonWordList,
  emptyState,
  emptyIcon,
  listContainer,
} from '@/lib/styles';
import type { Word } from '@/types/word';

type SortOrder = 'priority' | 'newest' | 'alphabetical';

function sortWords(words: Word[], order: SortOrder): Word[] {
  return [...words].sort((a, b) => {
    if (order === 'priority') {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.createdAt.getTime() - a.createdAt.getTime();
    }
    if (order === 'newest') return b.createdAt.getTime() - a.createdAt.getTime();
    return a.term.localeCompare(b.term, 'ja');
  });
}

export default function MasteredPage() {
  const repo = useRepository();
  const authLoading = useAuthStore((s) => s.loading);
  const { t } = useTranslation();
  const [words, setWords] = useState<Word[]>([]);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { searchInput, appliedQuery, setSearchInput, handleSearch, handleSearchClear } = useSearch();

  const [loading] = useLoader(async () => {
    if (!appliedQuery) {
      const cached = getListCache<Word[]>('mastered');
      if (cached) {
        setWords(cached.data);
        return true; // skip delay — data from cache
      }
    }
    const data = await repo.words.getMastered();
    if (appliedQuery) {
      const lower = appliedQuery.toLowerCase();
      setWords(
        data.filter(
          (w) =>
            w.term.toLowerCase().includes(lower) ||
            w.reading.toLowerCase().includes(lower) ||
            w.meaning.toLowerCase().includes(lower),
        ),
      );
    } else {
      setWords(data);
      setListCache('mastered', data);
    }
  }, [repo, appliedQuery], { skip: authLoading });

  const handleUnmaster = async (wordId: string) => {
    await repo.words.setMastered(wordId, false);
    const updated = words.filter((w) => w.id !== wordId);
    setWords(updated);
    setListCache('mastered', updated);
    invalidateListCache('words');
  };

  const handleDeleteRequest = (wordId: string) => {
    setDeleteTarget(wordId);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await repo.words.delete(deleteTarget);
    const updated = words.filter((w) => w.id !== deleteTarget);
    setWords(updated);
    setListCache('mastered', updated);
    setDeleteTarget(null);
    toast.success(t.words.wordDeleted);
  };

  return (
    <>
      <Header title={t.masteredPage.title} />

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
        onSortChange={(v) => setSortOrder(v as SortOrder)}
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
        <div className={listContainer}>
          {sortWords(words, sortOrder).map((word, i) => (
            <div
              key={word.id}
              className="animate-stagger"
              style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
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
          ))}
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
