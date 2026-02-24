'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Trash2, X } from 'lucide-react';
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
import { invalidateListCache } from '@/lib/list-cache';
import { bottomBar, bottomSep } from '@/lib/styles';
import type { Word, StudyProgress } from '@/types/word';

export default function WordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const authLoading = useAuthStore((s) => s.loading);
  const { t, locale } = useTranslation();
  const [word, setWord] = useState<Word | null>(null);
  const [progress, setProgress] = useState<StudyProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [wordbookDialogOpen, setWordbookDialogOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    Promise.all([
      repo.words.getById(id),
      repo.study.getProgress(id),
    ]).then(([w, p]) => {
      setWord(w);
      setProgress(p);
      setLoading(false);
    });
  }, [repo, id, authLoading]);

  const handleUpdate = async (data: Parameters<typeof repo.words.update>[1]) => {
    try {
      await repo.words.update(id, data);
      invalidateListCache('words');
      invalidateListCache('mastered');
      toast.success(t.words.wordUpdated);
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
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
        <div className="py-8 text-center text-muted-foreground">
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
          actions={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setEditing(false)}
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
        />
      </>
    );
  }

  return (
    <>
      <Header
        title={t.wordDetail.title}
        showBack
        actions={
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
              onClick={() => setEditing(true)}
              data-testid="word-edit-button"
              aria-label={t.common.edit}
            >
              <Pencil className="size-5" />
            </Button>
          </div>
        }
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
            </div>
            <div className="text-lg text-muted-foreground">{word.reading}</div>
          </div>

          <Separator />

          {/* Meaning */}
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">
              {t.wordDetail.meaning}
            </div>
            <div className="mt-1 text-2xl font-semibold text-primary">
              {word.meaning}
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
