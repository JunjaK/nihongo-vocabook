'use client';

import { useState, useCallback, useMemo, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BookOpen, Info, Link2Off, Pencil, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { Button } from '@/components/ui/button';
import { SwipeableWordCard } from '@/components/word/swipeable-word-card';
import { WordCard } from '@/components/word/word-card';
import { WordbookForm } from '@/components/wordbook/wordbook-form';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { useSearch } from '@/hooks/use-search';
import { markWordMastered } from '@/lib/actions/mark-mastered';
import { getWordSortOptions } from '@/lib/constants';
import { invalidateListCache } from '@/lib/list-cache';
import {
  bottomBar,
  bottomSep,
  emptyState,
  emptyIcon,
} from '@/lib/styles';
import type { Word } from '@/types/word';
import type { WordSortOrder } from '@/lib/repository/types';
import type { Wordbook } from '@/types/wordbook';

const PAGE_SIZE = 100;

export default function WordbookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const { t, locale } = useTranslation();
  const [wordbook, setWordbook] = useState<Wordbook | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [sortOrder, setSortOrder] = useState<WordSortOrder>('newest');
  const [showInfo, setShowInfo] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isOwned = wordbook && user && wordbook.userId === user.id;
  const isSubscribed = wordbook && user && wordbook.userId !== user.id;

  const parentRef = useRef<HTMLDivElement>(null);

  const { searchInput, appliedQuery, setSearchInput, handleSearch, handleSearchClear } = useSearch();

  const hasMore = !appliedQuery && sortOrder !== 'priority' && words.length < totalCount;

  const [loading] = useLoader(async () => {
    const shouldLoadAll = appliedQuery || sortOrder === 'priority';
    const [wb, loadedWords] = await Promise.all([
      repo.wordbooks.getById(id),
      shouldLoadAll
        ? repo.wordbooks.getWords(id)
        : repo.wordbooks.getWordsPaginated(id, {
          limit: PAGE_SIZE,
          offset: 0,
          sort: sortOrder,
        }).then((result) => {
          setTotalCount(result.totalCount);
          return result.words;
        }),
    ]);
    setWordbook(wb);
    if (sortOrder === 'priority') {
      const sorted = [...loadedWords].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      setWords(sorted);
    } else {
      setWords(loadedWords);
    }
    if (shouldLoadAll) {
      setTotalCount(loadedWords.length);
    }
  }, [repo, id, appliedQuery, sortOrder], { skip: authLoading });

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await repo.wordbooks.getWordsPaginated(id, {
        limit: PAGE_SIZE,
        offset: words.length,
        sort: sortOrder,
      });
      setWords((prev) => [...prev, ...result.words]);
      setTotalCount(result.totalCount);
    } finally {
      setLoadingMore(false);
    }
  }, [repo, id, words.length, sortOrder, loadingMore, hasMore]);

  const handleUpdate = async (values: { name: string; description: string | null; isShared?: boolean; tags?: string[] }) => {
    await repo.wordbooks.update(id, values);
    invalidateListCache('wordbooks');
    toast.success(t.wordbooks.wordbookUpdated);
    setEditing(false);
    const updated = await repo.wordbooks.getById(id);
    setWordbook(updated);
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    await repo.wordbooks.delete(id);
    invalidateListCache('wordbooks');
    toast.success(t.wordbooks.wordbookDeleted);
    router.push('/wordbooks');
  };

  const handleUnsubscribe = async () => {
    await repo.wordbooks.unsubscribe(id);
    invalidateListCache('wordbooks');
    toast.success(t.wordbooks.unsubscribed);
    router.push('/wordbooks');
  };

  const handleMasterWord = async (wordId: string) => {
    await markWordMastered(repo, wordId);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
  };

  const handleRemoveWord = async (wordId: string) => {
    await repo.wordbooks.removeWord(id, wordId);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    toast.success(t.wordbooks.wordRemoved);
  };

  const sortOptions = getWordSortOptions(t);

  const sortedWords = useMemo(() => {
    if (!appliedQuery) return words;
    const result = [...words];
    if (sortOrder === 'alphabetical') {
      result.sort((a, b) => a.term.localeCompare(b.term, 'ja'));
    } else if (sortOrder === 'priority') {
      result.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    } else {
      result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return result;
  }, [words, sortOrder]);

  const filteredWords = useMemo(() => {
    if (!appliedQuery) return words;
    const lower = appliedQuery.toLowerCase();
    return sortedWords.filter((w) =>
      w.term.toLowerCase().includes(lower) ||
      w.reading.toLowerCase().includes(lower) ||
      w.meaning.toLowerCase().includes(lower)
    );
  }, [words, sortedWords, appliedQuery]);

  const virtualizer = useVirtualizer({
    count: filteredWords.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  const handleScroll = useCallback(() => {
    if (!parentRef.current || !hasMore || loadingMore) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    if (scrollHeight - scrollTop - clientHeight < 300) {
      loadMore();
    }
  }, [hasMore, loadingMore, loadMore]);

  if (!loading && !wordbook) {
    return (
      <>
        <Header title={t.wordbooks.title} showBack />
        <div className="py-8 text-center text-muted-foreground">
          {t.words.wordNotFound}
        </div>
      </>
    );
  }

  if (!loading && wordbook && editing) {
    return (
      <>
        <Header
          title={t.wordbooks.editWordbook}
          showBack
          actions={
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive"
                onClick={() => setShowDeleteConfirm(true)}
                data-testid="wordbook-delete-button"
                aria-label={t.common.delete}
              >
                <Trash2 className="size-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditing(false)}
                data-testid="wordbook-cancel-edit-button"
                aria-label={t.common.cancel}
              >
                <X className="size-5" />
              </Button>
            </>
          }
        />
        <WordbookForm
          initialValues={{
            name: wordbook.name,
            description: wordbook.description,
            isShared: wordbook.isShared,
            tags: wordbook.tags,
          }}
          createdAt={wordbook.createdAt}
          onSubmit={handleUpdate}
          submitLabel={t.common.update}
          showShareToggle={!!user}
        />
      </>
    );
  }

  if (!loading && wordbook && showInfo) {
    return (
      <>
        <Header
          title={t.wordbooks.wordbookInfo}
          showBack
          actions={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowInfo(false)}
              aria-label={t.common.cancel}
            >
              <X className="size-5" />
            </Button>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t.wordbooks.readOnly}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">{t.wordbooks.name}</div>
              <div className="text-base">{wordbook.name}</div>
            </div>
            {wordbook.description && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">{t.wordbooks.description}</div>
                <div className="text-sm">{wordbook.description}</div>
              </div>
            )}
            {wordbook.tags && wordbook.tags.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">{t.wordbooks.tags}</div>
                <div className="flex flex-wrap gap-1.5">
                  {wordbook.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <div className="text-sm font-medium text-muted-foreground">{t.common.createdAt}</div>
              <div className="text-sm">
                {wordbook.createdAt.toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US')}
              </div>
            </div>
          </div>
          <div className={bottomBar}>
            <div className={bottomSep} />
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive"
              onClick={handleUnsubscribe}
              data-testid="wordbook-unsubscribe-button"
            >
              <Link2Off className="mr-2 size-4" />
              {t.wordbooks.unsubscribe}
            </Button>
          </div>
        </div>
      </>
    );
  }

  const renderWordCard = (word: Word) => {
    if (isOwned) {
      return (
        <SwipeableWordCard
          word={word}
          showReading={showReading}
          showMeaning={showMeaning}
          onSwipeAction={handleMasterWord}
          swipeLabel={t.wordDetail.markMastered}
          swipeColor="green"
          contextMenuActions={[
            {
              label: t.wordDetail.markMastered,
              onAction: handleMasterWord,
            },
            {
              label: t.wordbooks.removeWord,
              onAction: handleRemoveWord,
              variant: 'destructive',
            },
          ]}
        />
      );
    }
    if (isSubscribed) {
      return (
        <SwipeableWordCard
          word={word}
          showReading={showReading}
          showMeaning={showMeaning}
          onSwipeAction={handleMasterWord}
          swipeLabel={t.wordDetail.markMastered}
          swipeColor="green"
          contextMenuActions={[
            {
              label: t.wordDetail.markMastered,
              onAction: handleMasterWord,
            },
          ]}
        />
      );
    }
    return (
      <WordCard
        word={word}
        showReading={showReading}
        showMeaning={showMeaning}
      />
    );
  };

  return (
    <>
      <Header
        title={wordbook?.name ?? ''}
        desc={!loading && totalCount > 0 ? t.wordbooks.wordCount(totalCount) : undefined}
        showBack
        actions={
          loading ? undefined : isSubscribed ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowInfo(true)}
              data-testid="wordbook-info-button"
              aria-label={t.wordbooks.wordbookInfo}
            >
              <Info className="size-5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setEditing(true)}
              data-testid="wordbook-edit-button"
              aria-label={t.common.edit}
            >
              <Pencil className="size-5" />
            </Button>
          )
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
        onSortChange={(v) => setSortOrder(v as WordSortOrder)}
      />

      {loading ? (
        <div className="animate-page flex-1 space-y-2 overflow-y-auto px-4 pt-2">
          {Array.from({ length: 20 }).map((_, i) => (
            <Skeleton key={i} className="h-[60px] w-full rounded-lg" />
          ))}
        </div>
      ) : totalCount === 0 ? (
        <div className={emptyState}>
          <BookOpen className={emptyIcon} />
          {t.wordbooks.noWords}
        </div>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={handleScroll}>
          {filteredWords.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              {t.words.noWords}
            </div>
          ) : (
            <div
              className="relative px-4 pt-2 pb-2"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((vr) => {
                const word = filteredWords[vr.index];
                return (
                  <div
                    key={word.id}
                    ref={virtualizer.measureElement}
                    data-index={vr.index}
                    className="absolute left-4 right-4 pb-2"
                    style={{ transform: `translateY(${vr.start}px)` }}
                  >
                    {renderWordCard(word)}
                  </div>
                );
              })}
            </div>
          )}
          {loadingMore && (
            <div className="flex justify-center py-4">
              <div className="text-sm text-muted-foreground">{t.common.loading}</div>
            </div>
          )}
        </div>
      )}

      <div className={bottomBar}>
        <div className={bottomSep} />
        {loading ? (
          isOwned ? (
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled>{t.wordbooks.startQuiz}</Button>
              <Button className="flex-1" disabled>{t.wordbooks.addWords}</Button>
            </div>
          ) : (
            <Button className="w-full" disabled>
              {t.wordbooks.startQuiz}
            </Button>
          )
        ) : isOwned ? (
          <div className="flex gap-2">
            {words.length > 0 && (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => router.push(`/wordbooks/${id}/practice`)}
                data-testid="wordbook-start-quiz"
              >
                {t.wordbooks.startQuiz}
              </Button>
            )}
            <Link href={`/wordbooks/${id}/add-words`} className="flex-1">
              <Button
                className="w-full"
                data-testid="wordbook-add-words-button"
              >
                {t.wordbooks.addWords}
              </Button>
            </Link>
          </div>
        ) : (
          <Button
            className="w-full"
            disabled={words.length === 0}
            onClick={() => router.push(`/wordbooks/${id}/practice`)}
            data-testid="wordbook-start-quiz"
          >
            {t.wordbooks.startQuiz}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        icon={<Trash2 className="text-destructive" />}
        title={t.common.delete}
        description={t.wordbooks.deleteConfirm}
        destructive
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
