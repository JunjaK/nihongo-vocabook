'use client';

import { useState, useEffect, use, useRef, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
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
import { KanjiText } from '@/components/kanji/kanji-text';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { getListCache, invalidateListCache } from '@/lib/list-cache';
import { scrollArea, bottomBar, bottomSep, emptyState, sectionLabel } from '@/lib/styles';
import type { WordSortOrder } from '@/lib/repository/types';
import type { Word, WordExample, StudyProgress } from '@/types/word';

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const repo = useRepository();
  const authLoading = useAuthStore((s) => s.loading);
  const isMasteredContext = pathname.startsWith('/mastered/');
  const basePath = isMasteredContext ? '/mastered' : '/words';
  const { t, locale } = useTranslation();
  const [word, setWord] = useState<Word | null>(null);
  const [progress, setProgress] = useState<StudyProgress | null>(null);
  const [examples, setExamples] = useState<WordExample[]>([]);
  const [revealedExamples, setRevealedExamples] = useState<Set<string>>(new Set());
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

    const orderedWordsPromise = isMasteredContext
      ? repo.words.getMastered()
      : (() => {
        const wordsCache = getListCache<WordsCacheData>('words');
        const cachedWords = wordsCache?.data.words ?? [];
        const hasCurrentInCache = cachedWords.some((item) => item.id === id);
        return hasCurrentInCache
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
      })();

    Promise.all([
      repo.words.getById(id),
      repo.study.getProgress(id),
      orderedWordsPromise,
    ]).then(async ([w, p, orderedWords]) => {
      const currentIndex = orderedWords.findIndex((item) => item.id === id);
      setPrevWordId(currentIndex > 0 ? orderedWords[currentIndex - 1]?.id ?? null : null);
      setNextWordId(
        currentIndex >= 0 && currentIndex < orderedWords.length - 1
          ? orderedWords[currentIndex + 1]?.id ?? null
          : null,
      );
      setWord(w);
      setProgress(p);
      // Examples are keyed by dictionary_entry_id — fetch after we have the word.
      const ex = w?.dictionaryEntryId
        ? await repo.words.getExamples(w.dictionaryEntryId)
        : [];
      setExamples(ex);
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
    router.push(basePath);
  };

  const handleToggleMastered = async () => {
    if (!word) return;
    const wasMastered = word.mastered;
    await repo.words.setMastered(id, !wasMastered);
    invalidateListCache('words');
    invalidateListCache('mastered');
    invalidateListCache('wordbooks');
    // When marking as mastered from words list, auto-advance
    if (!wasMastered) {
      toast.success(t.wordDetail.markMastered);
      if (nextWordId) {
        router.replace(`${basePath}/${nextWordId}`);
      } else {
        router.back();
      }
      return;
    }
    const updated = await repo.words.getById(id);
    setWord(updated);
  };

  const handleSetPriority = async (priority: number) => {
    await repo.words.update(id, { priority });
    setWord((prev) => prev ? { ...prev, priority } : prev);
  };

  const handleMoveWord = (targetId: string | null) => {
    if (!targetId) return;
    router.push(`${basePath}/${targetId}?showInfo=${showWordInfo ? '1' : '0'}`);
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
        <Header title={t.wordDetail.title} showBack onBack={() => router.push(basePath)} />
        <div className={cn(scrollArea, 'px-5 py-4')}>
          <div className="animate-page flex flex-col gap-6">
            {/* Word block card */}
            <Skeleton className="h-[180px] w-full rounded-xl" />
            {/* Divider */}
            <div className="h-px bg-secondary" />
            {/* Meta grid: LEVEL / PRIORITY / CREATED */}
            <div className="flex justify-between">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="mt-1 h-5 w-20" />
              </div>
              <div className="flex flex-col gap-1">
                <Skeleton className="h-3 w-14" />
                <div className="mt-1 flex gap-1.5">
                  <Skeleton className="h-6 w-14 rounded-full" />
                  <Skeleton className="h-6 w-14 rounded-full" />
                  <Skeleton className="h-6 w-14 rounded-full" />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="mt-1 h-5 w-24" />
              </div>
            </div>
            {/* Divider */}
            <div className="h-px bg-secondary" />
            {/* Study progress */}
            <div className="flex flex-col gap-3">
              <Skeleton className="h-3 w-20" />
              <div className="flex gap-4">
                <Skeleton className="h-16 flex-1 rounded-lg" />
                <Skeleton className="h-16 flex-1 rounded-lg" />
              </div>
            </div>
            {/* Divider */}
            <div className="h-px bg-secondary" />
            {/* Tags */}
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-8" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-14 rounded-md" />
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            </div>
          </div>
        </div>
        <div className={bottomBar}>
          <div className={bottomSep} />
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" disabled>{t.wordDetail.addToWordbook}</Button>
            <Button className="flex-1" disabled>{t.wordDetail.markMastered}</Button>
          </div>
        </div>
      </>
    );
  }

  if (!word) {
    return (
      <>
        <Header title={t.wordDetail.title} showBack onBack={() => router.push(basePath)} />
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
        onBack={() => router.push(basePath)}
        actions={word.isOwned ? (
          <div className="flex gap-1">
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
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowDeleteConfirm(true)}
              data-testid="word-delete-button"
              aria-label={t.common.delete}
            >
              <Trash2 className="size-5" />
            </Button>
          </div>
        ) : undefined}
      />

      <div className={cn(scrollArea, 'px-5 py-4')}>
        <div className="animate-page flex flex-col gap-6">

          {/* Word block — kanji/reading/meaning card */}
          <div className="relative overflow-hidden rounded-xl bg-secondary">
            {/* Prev/Next navigation arrows */}
            <button
              className="absolute left-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center disabled:opacity-30"
              onClick={() => handleMoveWord(prevWordId)}
              disabled={!prevWordId}
              data-testid="word-prev-button"
              aria-label={t.common.previous}
            >
              <ChevronLeft className="size-5 text-text-tertiary" />
            </button>
            <button
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center disabled:opacity-30"
              onClick={() => handleMoveWord(nextWordId)}
              disabled={!nextWordId}
              data-testid="word-next-button"
              aria-label={t.common.next}
            >
              <ChevronRight className="size-5 text-text-tertiary" />
            </button>

            {/* Subscribed badge — top-left */}
            {!word.isOwned && (
              <Badge variant="secondary" className="absolute left-2 top-2 rounded-md bg-background/80 text-text-tertiary">
                <LinkIcon className="mr-1 size-3" />
                {t.wordDetail.subscribedWord}
              </Badge>
            )}

            {/* Eye toggle button — top-right inside card */}
            <button
              className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-[10px] border border-border bg-card"
              onClick={() => setShowWordInfo((prev) => !prev)}
              data-testid="word-toggle-info-button"
              aria-label={`${t.words.showReading} / ${t.words.showMeaning}`}
            >
              {showWordInfo ? (
                <EyeOff className="size-icon text-primary dark:text-accent-muted" />
              ) : (
                <Eye className="size-icon text-text-tertiary" />
              )}
            </button>

            {/* Center content */}
            <div className="flex min-h-[180px] flex-col items-center justify-center py-6 text-center">
              {/* Reading */}
              <div
                className={cn(
                  'text-reading text-text-secondary transition-[opacity,filter] duration-300 ease-out',
                  showWordInfo ? 'opacity-100 blur-0' : 'opacity-70 blur-[2px]',
                )}
              >
                {showWordInfo ? word.reading : '•••'}
              </div>
              {/* Kanji */}
              <div className="mt-1 text-kanji-lg font-medium leading-tight text-foreground">
                <KanjiText text={word.term} />
              </div>
              {/* Meaning */}
              <div
                className={cn(
                  'text-section font-medium text-primary dark:text-accent-muted transition-[opacity,filter] duration-300 ease-out',
                  showWordInfo ? 'opacity-100 blur-0' : 'opacity-70 blur-[2px]',
                )}
              >
                {showWordInfo ? word.meaning : '•••'}
              </div>

              {/* Status badges */}
              {word.isLeech && (
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  {word.isLeech && (
                    <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                      <AlertTriangle className="mr-1 size-3" />
                      {t.wordDetail.leech}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-secondary" />

          {/* Meta grid — LEVEL / PRIORITY / CREATED */}
          <div className="flex justify-between">
            <div className="flex shrink-0 flex-col gap-1">
              <div className={sectionLabel}>{t.wordDetail.difficulty}</div>
              <div className="text-body font-medium">
                {word.jlptLevel ? `JLPT N${word.jlptLevel}` : t.wordDetail.unclassified}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <div className={sectionLabel}>{t.priority.title}</div>
              <div className="flex gap-1.5">
                {[
                  { value: 1, label: t.priority.high, color: 'bg-destructive' },
                  { value: 2, label: t.priority.medium, color: 'bg-primary' },
                  { value: 3, label: t.priority.low, color: 'bg-text-tertiary' },
                ].map((p) => (
                  <button
                    key={p.value}
                    onClick={() => handleSetPriority(p.value)}
                    className={cn(
                      'flex items-center gap-1 rounded-full border px-2 py-0.5 text-badge font-medium transition-colors',
                      word.priority === p.value
                        ? 'border-primary bg-primary/10 text-primary dark:border-accent-muted dark:bg-accent-muted/10 dark:text-accent-muted'
                        : 'border-border text-text-secondary hover:bg-accent',
                    )}
                  >
                    <span className={cn('size-1.5 rounded-full', p.color)} />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <div className={sectionLabel}>{t.common.createdAt}</div>
              <div className="text-reading font-semibold">
                {word.createdAt.toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US')}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-secondary" />

          {/* Study Progress */}
          <div className="flex flex-col gap-3">
            <div className={sectionLabel}>{t.wordDetail.studyProgress}</div>
            <div className="flex gap-4">
              <div className="flex flex-1 flex-col gap-1 rounded-lg bg-secondary p-3">
                <div className={sectionLabel}>{t.wordDetail.reviews}</div>
                <div className="text-body font-medium">{progress?.reviewCount ?? 0}</div>
              </div>
              <div className="flex flex-1 flex-col gap-1 rounded-lg bg-secondary p-3">
                <div className={sectionLabel}>{t.wordDetail.nextReview}</div>
                <div className="text-body font-medium">
                  {progress ? formatNextReview(progress.nextReview) : t.wordDetail.notStarted}
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-secondary" />

          {/* Tags */}
          <div className="flex flex-col gap-2">
            <div className={sectionLabel}>{t.wordDetail.tags}</div>
            {word.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {word.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md bg-secondary px-3 py-2 text-caption font-medium text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-caption text-text-tertiary">{t.wordDetail.noTags}</div>
            )}
          </div>

          {/* Notes */}
          {word.notes && (
            <div className="flex flex-col gap-2">
              <div className={sectionLabel}>{t.wordDetail.notes}</div>
              <div className="rounded-lg bg-secondary p-3 text-body">{word.notes}</div>
            </div>
          )}

          {/* Examples */}
          {examples.length > 0 && (
            <>
              <div className="h-px bg-secondary" />
              <div className="flex flex-col gap-3">
                <div className={sectionLabel}>{t.wordDetail.examples}</div>
                {examples.map((ex) => {
                  const revealed = revealedExamples.has(ex.id);
                  const toggle = () => setRevealedExamples((prev) => {
                    const next = new Set(prev);
                    if (next.has(ex.id)) next.delete(ex.id);
                    else next.add(ex.id);
                    return next;
                  });
                  return (
                    <div
                      key={ex.id}
                      role="button"
                      tabIndex={0}
                      onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggle();
                        }
                      }}
                      className="flex cursor-pointer flex-col gap-1 rounded-lg bg-secondary p-3 text-left"
                    >
                      <div className="text-body font-medium">
                        <KanjiText text={ex.sentenceJa} />
                      </div>
                      {ex.sentenceReading && (
                        <div
                          className={cn(
                            'text-reading text-text-secondary transition-[opacity,filter] duration-300 ease-out',
                            revealed ? 'opacity-100 blur-0' : 'opacity-60 blur-[3px] select-none',
                          )}
                        >
                          {ex.sentenceReading}
                        </div>
                      )}
                      {ex.sentenceMeaning && (
                        <div
                          className={cn(
                            'text-caption text-primary dark:text-accent-muted transition-[opacity,filter] duration-300 ease-out',
                            revealed ? 'opacity-100 blur-0' : 'opacity-60 blur-[3px] select-none',
                          )}
                        >
                          {ex.sentenceMeaning}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Action Buttons — fixed outside scroll */}
      <div className={bottomBar}>
        <div className={bottomSep} />
        <div className="flex gap-3">
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
