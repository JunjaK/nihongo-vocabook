'use client';

import { useState, useEffect, use, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Trash2, X, LinkIcon, AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { Header } from '@/components/layout/header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { WordForm } from '@/components/word/word-form';
import { AddToWordbookDialog } from '@/components/wordbook/add-to-wordbook-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { getListCache, invalidateListCache } from '@/lib/list-cache';
import { scrollArea, bottomBar, bottomSep, emptyState } from '@/lib/styles';
import type { WordSortOrder } from '@/lib/repository/types';
import type { Word, StudyProgress } from '@/types/word';

interface WordsCacheData {
  words: Word[];
  totalCount: number;
  sortOrder: WordSortOrder;
}

export default function WordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const repo = useRepository();
  const authLoading = useAuthStore((s) => s.loading);
  const { t, locale } = useTranslation();
  const [word, setWord] = useState<Word | null>(null);
  const [progress, setProgress] = useState<StudyProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [wordbookDialogOpen, setWordbookDialogOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [showLeaveEditConfirm, setShowLeaveEditConfirm] = useState(false);
  const pendingEditLeaveRef = useRef<(() => void) | null>(null);
  const [prevWordId, setPrevWordId] = useState<string | null>(null);
  const [nextWordId, setNextWordId] = useState<string | null>(null);
  const [showWordInfo, setShowWordInfo] = useState(
    () => searchParams.get('showInfo') !== '0',
  );
  const requestLeaveEdit = useCallback((action: () => void) => {
    if (!editDirty) {
      action();
      return;
    }
    pendingEditLeaveRef.current = action;
    setShowLeaveEditConfirm(true);
  }, [editDirty]);

  useEffect(() => {
    if (authLoading) return;
    const wordsCache = getListCache<WordsCacheData>('words');
    const cachedWords = wordsCache?.data.words ?? [];
    const hasCurrentInCache = cachedWords.some((item) => item.id === id);

    const orderedWordsPromise = hasCurrentInCache
      ? Promise.resolve(cachedWords)
      : repo.words.getNonMastered().then((allWords) => {
        const sortOrder = wordsCache?.data.sortOrder ?? 'priority';
        if (sortOrder === 'newest') {
          return [...allWords].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (sortOrder === 'alphabetical') {
          return [...allWords].sort((a, b) => a.term.localeCompare(b.term, 'ja'));
        }
        return allWords;
      });

    Promise.all([
      repo.words.getById(id),
      repo.study.getProgress(id),
      orderedWordsPromise,
    ]).then(([w, p, orderedWords]) => {
      const currentIndex = orderedWords.findIndex((item) => item.id === id);
      setPrevWordId(currentIndex > 0 ? orderedWords[currentIndex - 1]?.id ?? null : null);
      setNextWordId(
        currentIndex >= 0 && currentIndex < orderedWords.length - 1
          ? orderedWords[currentIndex + 1]?.id ?? null
          : null,
      );
      setWord(w);
      setProgress(p);
      setLoading(false);
    });
  }, [repo, id, authLoading]);

  useEffect(() => {
    if (!editing || !editDirty) return undefined;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editing, editDirty]);

  useEffect(() => {
    if (!editing || !editDirty) return undefined;
    const handleDocumentClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = (e.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!target) return;

      const href = target.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      if (target.target && target.target !== '_self') return;

      e.preventDefault();
      requestLeaveEdit(() => {
        if (/^https?:\/\//.test(href)) {
          window.location.assign(href);
        } else {
          router.push(href);
        }
      });
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => document.removeEventListener('click', handleDocumentClick, true);
  }, [editing, editDirty, requestLeaveEdit, router]);

  const handleConfirmLeaveEdit = () => {
    setShowLeaveEditConfirm(false);
    const next = pendingEditLeaveRef.current;
    pendingEditLeaveRef.current = null;
    setEditDirty(false);
    next?.();
  };

  const handleCancelLeaveEdit = () => {
    setShowLeaveEditConfirm(false);
    pendingEditLeaveRef.current = null;
  };

  const handleUpdate = async (data: Parameters<typeof repo.words.update>[1]) => {
    try {
      await repo.words.update(id, data);
      invalidateListCache('words');
      invalidateListCache('mastered');
      toast.success(t.words.wordUpdated);
      setEditDirty(false);
      setEditing(false);
      const updated = await repo.words.getById(id);
      setWord(updated);
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_WORD') {
        toast.error(t.words.duplicateWord);
      } else {
        throw err;
      }
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    await repo.words.delete(id);
    invalidateListCache('words');
    invalidateListCache('mastered');
    toast.success(t.words.wordDeleted);
    router.push('/words');
  };

  const handleToggleMastered = async () => {
    if (!word) return;
    const updated = await repo.words.setMastered(id, !word.mastered);
    invalidateListCache('words');
    invalidateListCache('mastered');
    invalidateListCache('wordbooks');
    setWord(updated);
  };

  const handleSetPriority = async (priority: number) => {
    await repo.words.update(id, { priority });
    setWord((prev) => prev ? { ...prev, priority } : prev);
  };

  const handleMoveWord = (targetId: string | null) => {
    if (!targetId) return;
    router.push(`/words/${targetId}?showInfo=${showWordInfo ? '1' : '0'}`);
  };

  const formatNextReview = (nextReview: Date) => {
    const now = new Date();
    const diffMs = nextReview.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return t.wordDetail.now;
    if (diffDays === 1) return t.wordDetail.tomorrow;
    return t.wordDetail.days(diffDays);
  };

  if (loading) {
    return (
      <>
        <Header title={t.wordDetail.title} showBack />
        <div className={cn(scrollArea, 'min-h-0 p-4')}>
          <div className="animate-page space-y-5">
            {/* Term + Reading skeleton */}
            <div>
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="mt-2 h-5 w-1/4" />
            </div>
            <Separator />
            {/* Meaning skeleton */}
            <div>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-7 w-2/3" />
            </div>
            {/* Difficulty + Priority skeleton */}
            <div className="flex gap-6">
              <div className="shrink-0">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-2 h-4 w-20" />
              </div>
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-12" />
                <div className="mt-2 flex gap-1.5">
                  <Skeleton className="h-6 w-14 rounded-full" />
                  <Skeleton className="h-6 w-14 rounded-full" />
                  <Skeleton className="h-6 w-14 rounded-full" />
                </div>
              </div>
            </div>
            {/* Tags skeleton */}
            <div>
              <Skeleton className="h-3 w-10" />
              <div className="mt-2 flex gap-1">
                <Skeleton className="h-5 w-12 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
            <Separator />
            {/* Study progress + Created date skeleton */}
            <div className="flex gap-6">
              <div className="flex-1">
                <Skeleton className="h-3 w-24" />
                <div className="mt-2 space-y-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <Skeleton className="ml-auto h-3 w-20" />
                <Skeleton className="ml-auto mt-2 h-4 w-24" />
              </div>
            </div>
          </div>
        </div>
        <div className={bottomBar}>
          <div className={bottomSep} />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled>{t.wordDetail.markMastered}</Button>
            <Button className="flex-1" disabled>{t.wordDetail.addToWordbook}</Button>
          </div>
        </div>
      </>
    );
  }

  if (!word) {
    return (
      <>
        <Header title={t.wordDetail.title} showBack />
        <div className={emptyState}>
          {t.words.wordNotFound}
        </div>
      </>
    );
  }

  if (editing) {
    return (
      <>
        <Header
          title={t.words.editWord}
          showBack
          onBack={() => requestLeaveEdit(() => setEditing(false))}
          actions={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => requestLeaveEdit(() => setEditing(false))}
              aria-label={t.common.cancel}
            >
              <X className="size-5" />
            </Button>
          }
        />
        <WordForm
          initialValues={word}
          onSubmit={handleUpdate}
          submitLabel={t.common.update}
          onDirtyChange={setEditDirty}
        />
        <ConfirmDialog
          open={showLeaveEditConfirm}
          icon={<AlertTriangle className="text-destructive" />}
          title={t.common.unsavedChangesTitle}
          description={t.common.unsavedChangesDescription}
          confirmLabel={t.common.leave}
          onConfirm={handleConfirmLeaveEdit}
          onCancel={handleCancelLeaveEdit}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title={t.wordDetail.title}
        showBack
        actions={word.isOwned ? (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive"
              onClick={() => setShowDeleteConfirm(true)}
              data-testid="word-delete-button"
              aria-label={t.common.delete}
            >
              <Trash2 className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setEditDirty(false);
                setEditing(true);
              }}
              data-testid="word-edit-button"
              aria-label={t.common.edit}
            >
              <Pencil className="size-5" />
            </Button>
          </div>
        ) : undefined}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="animate-page space-y-5">
          {/* Term + Reading */}
          <div>
            <div className="flex items-center gap-2">
              <div className="text-3xl font-bold">{word.term}</div>
              {word.mastered && (
                <Badge variant="secondary" className="bg-green-100 text-green-700">
                  {t.nav.mastered}
                </Badge>
              )}
              {word.isLeech && (
                <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                  <AlertTriangle className="mr-1 size-3" />
                  {t.wordDetail.leech}
                </Badge>
              )}
              {!word.isOwned && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  <LinkIcon className="mr-1 size-3" />
                  {t.wordDetail.subscribedWord}
                </Badge>
              )}
            </div>
            <div
              className={cn(
                'text-lg text-muted-foreground transition-[opacity,filter,transform] duration-300 ease-out',
                showWordInfo
                  ? 'translate-y-0 scale-100 opacity-100 blur-0'
                  : '-translate-y-0.5 scale-[0.99] opacity-70 blur-[1px]',
              )}
            >
              {showWordInfo ? word.reading : '•••'}
            </div>
          </div>

          <Separator />

          {/* Meaning */}
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">
              {t.wordDetail.meaning}
            </div>
            <div className="mt-1 flex items-start justify-between gap-2">
              <div
                className={cn(
                  'text-2xl font-semibold text-primary transition-[opacity,filter,transform] duration-300 ease-out',
                  showWordInfo
                    ? 'translate-y-0 scale-100 opacity-100 blur-0'
                    : '-translate-y-0.5 scale-[0.99] opacity-70 blur-[1px]',
                )}
              >
                {showWordInfo ? word.meaning : '•••'}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                onClick={() => setShowWordInfo((prev) => !prev)}
                data-testid="word-toggle-info-button"
                aria-label={`${t.words.showReading} / ${t.words.showMeaning}`}
              >
                {showWordInfo ? (
                  <Eye className="size-5 transition-transform duration-300 ease-out" />
                ) : (
                  <EyeOff className="size-5 transition-transform duration-300 ease-out" />
                )}
              </Button>
            </div>
          </div>

          {/* Difficulty + Priority — compact row */}
          <div className="flex gap-6">
            <div className="shrink-0">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {t.wordDetail.difficulty}
              </div>
              <div className="mt-1 text-sm font-medium">
                {word.jlptLevel ? `JLPT N${word.jlptLevel}` : t.wordDetail.unclassified}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {t.priority.title}
              </div>
              <div className="mt-1 flex gap-1.5">
                {[
                  { value: 1, label: t.priority.high, color: 'bg-red-500' },
                  { value: 2, label: t.priority.medium, color: 'bg-primary' },
                  { value: 3, label: t.priority.low, color: 'bg-gray-300' },
                ].map((p) => (
                  <button
                    key={p.value}
                    onClick={() => handleSetPriority(p.value)}
                    className={cn(
                      'flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      word.priority === p.value
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <span className={cn('size-1.5 rounded-full', p.color)} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Tags */}
          {word.tags.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {t.wordDetail.tags}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {word.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    #{tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {word.notes && (
            <div>
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {t.wordDetail.notes}
              </div>
              <div className="mt-1 rounded-md bg-muted p-3 text-sm">
                {word.notes}
              </div>
            </div>
          )}

          <Separator />

          {/* Study Progress + Created At — compact row */}
          <div className="flex gap-6 text-sm">
            <div className="flex-1">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {t.wordDetail.studyProgress}
              </div>
              <div className="mt-1 space-y-0.5">
                <div>
                  <span className="text-muted-foreground">{t.wordDetail.reviews}: </span>
                  <span className="font-medium">{progress?.reviewCount ?? 0}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t.wordDetail.nextReview}: </span>
                  <span className="font-medium">
                    {progress ? formatNextReview(progress.nextReview) : t.wordDetail.notStarted}
                  </span>
                </div>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {t.common.createdAt}
              </div>
              <div className="mt-1 font-medium">
                {word.createdAt.toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Button
        variant="outline"
        size="icon"
        className="fixed top-[60%] left-1 z-20 -translate-y-1/2 rounded-r-xl rounded-l-none border-l-0 shadow-md md:left-[calc(50%-14rem+0.25rem)]"
        onClick={() => handleMoveWord(prevWordId)}
        disabled={!prevWordId}
        data-testid="word-prev-button"
        aria-label={t.common.previous}
      >
        <ChevronLeft className="size-5" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="fixed top-[60%] right-1 z-20 -translate-y-1/2 rounded-l-xl rounded-r-none border-r-0 shadow-md md:right-[calc(50%-14rem+0.25rem)]"
        onClick={() => handleMoveWord(nextWordId)}
        disabled={!nextWordId}
        data-testid="word-next-button"
        aria-label={t.common.next}
      >
        <ChevronRight className="size-5" />
      </Button>

      {/* Action Buttons — fixed outside scroll */}
      <div className={bottomBar}>
        <div className={bottomSep} />
        <div className="flex gap-2">
          {!word.mastered && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setWordbookDialogOpen(true)}
              data-testid="word-add-to-wordbook-button"
            >
              {t.wordDetail.addToWordbook}
            </Button>
          )}

          <Button
            className="flex-1"
            onClick={handleToggleMastered}
            data-testid="word-mastered-button"
          >
            {word.mastered ? t.wordDetail.unmarkMastered : t.wordDetail.markMastered}
          </Button>
        </div>
      </div>

      <AddToWordbookDialog
        wordId={id}
        open={wordbookDialogOpen}
        onClose={() => setWordbookDialogOpen(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        icon={<Trash2 className="text-destructive" />}
        title={t.common.delete}
        description={t.words.deleteConfirm}
        destructive
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
