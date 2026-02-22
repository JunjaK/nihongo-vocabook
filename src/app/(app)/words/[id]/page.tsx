'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Header } from '@/components/layout/header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { WordForm } from '@/components/word/word-form';
import { AddToWordbookDialog } from '@/components/wordbook/add-to-wordbook-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { Word, StudyProgress } from '@/types/word';

export default function WordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const { t, locale } = useTranslation();
  const [word, setWord] = useState<Word | null>(null);
  const [progress, setProgress] = useState<StudyProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [wordbookDialogOpen, setWordbookDialogOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    Promise.all([
      repo.words.getById(id),
      repo.study.getProgress(id),
    ]).then(([w, p]) => {
      setWord(w);
      setProgress(p);
      setLoading(false);
    });
  }, [repo, id]);

  const handleUpdate = async (data: Parameters<typeof repo.words.update>[1]) => {
    try {
      await repo.words.update(id, data);
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
    toast.success(t.words.wordDeleted);
    router.push('/words');
  };

  const handleToggleMastered = async () => {
    if (!word) return;
    const updated = await repo.words.setMastered(id, !word.mastered);
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
        <div className="py-8 text-center text-muted-foreground">{t.common.loading}</div>
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
          actions={
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t.common.cancel}
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
              size="sm"
              onClick={() => setEditing(true)}
              data-testid="word-edit-button"
            >
              {t.common.edit}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setShowDeleteConfirm(true)}
              data-testid="word-delete-button"
            >
              {t.common.delete}
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="animate-page space-y-6">
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

          {/* JLPT Level */}
          {word.jlptLevel && (
            <div>
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {t.wordDetail.jlptLevel}
              </div>
              <div className="mt-1">
                <Badge variant="secondary">N{word.jlptLevel}</Badge>
              </div>
            </div>
          )}

          {/* Tags */}
          {word.tags.length > 0 && (
            <div>
              <div className="text-xs font-medium uppercase text-muted-foreground">
                {t.wordDetail.tags}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {word.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
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

          {/* Priority */}
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">
              {t.priority.title}
            </div>
            <div className="mt-2 flex gap-2">
              {[
                { value: 1, label: t.priority.high, color: 'bg-red-500' },
                { value: 2, label: t.priority.medium, color: 'bg-primary' },
                { value: 3, label: t.priority.low, color: 'bg-gray-300' },
              ].map((p) => (
                <button
                  key={p.value}
                  onClick={() => handleSetPriority(p.value)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                    word.priority === p.value
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'border-border text-muted-foreground hover:bg-accent',
                  )}
                >
                  <span className={cn('size-2 rounded-full', p.color)} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Study Progress */}
          <div>
            <div className="text-xs font-medium uppercase text-muted-foreground">
              {t.wordDetail.studyProgress}
            </div>
            <div className="mt-2 flex gap-6 text-sm">
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

          {/* Created At */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t.common.createdAt}</span>
            <span>{word.createdAt.toLocaleDateString(locale === 'ko' ? 'ko-KR' : 'en-US')}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons — fixed outside scroll */}
      <div className="shrink-0 bg-background px-4 pb-3">
        <div className="mb-3 h-px bg-border" />
        <div className="space-y-2">
        <Button
          className="w-full"
          onClick={() => router.push(`/quiz?wordId=${word.id}`)}
          data-testid="word-practice-button"
        >
          {t.wordDetail.practiceWord}
        </Button>

        <Button
          variant={word.mastered ? 'outline' : 'secondary'}
          className="w-full"
          onClick={handleToggleMastered}
          data-testid="word-mastered-button"
        >
          {word.mastered ? t.wordDetail.unmarkMastered : t.wordDetail.markMastered}
        </Button>

        {!word.mastered && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setWordbookDialogOpen(true)}
            data-testid="word-add-to-wordbook-button"
          >
            {t.wordDetail.addToWordbook}
          </Button>
        )}
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
