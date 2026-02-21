'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { SwipeableWordCard } from '@/components/word/swipeable-word-card';
import { WordbookForm } from '@/components/wordbook/wordbook-form';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { Word } from '@/types/word';
import type { Wordbook } from '@/types/wordbook';

export default function WordbookDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const repo = useRepository();
  const { t } = useTranslation();
  const [wordbook, setWordbook] = useState<Wordbook | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [wb, wds] = await Promise.all([
        repo.wordbooks.getById(id),
        repo.wordbooks.getWords(id),
      ]);
      setWordbook(wb);
      setWords(wds);
    } finally {
      setLoading(false);
    }
  }, [repo, id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpdate = async (values: { name: string; description: string | null }) => {
    await repo.wordbooks.update(id, values);
    toast.success(t.wordbooks.wordbookUpdated);
    setEditing(false);
    const updated = await repo.wordbooks.getById(id);
    setWordbook(updated);
  };

  const handleDelete = async () => {
    if (!window.confirm(t.wordbooks.deleteConfirm)) return;
    await repo.wordbooks.delete(id);
    toast.success(t.wordbooks.wordbookDeleted);
    router.push('/wordbooks');
  };

  const handleRemoveWord = async (wordId: string) => {
    await repo.wordbooks.removeWord(id, wordId);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    toast.success(t.wordbooks.wordRemoved);
  };

  if (loading) {
    return (
      <>
        <Header title={t.wordbooks.title} />
        <div className="p-4 text-center text-muted-foreground">{t.common.loading}</div>
      </>
    );
  }

  if (!wordbook) {
    return (
      <>
        <Header title={t.wordbooks.title} />
        <div className="p-4 text-center text-muted-foreground">
          {t.words.wordNotFound}
        </div>
      </>
    );
  }

  if (editing) {
    return (
      <>
        <Header
          title={t.wordbooks.editWordbook}
          actions={
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t.common.cancel}
            </Button>
          }
        />
        <div className="p-4">
          <WordbookForm
            initialValues={wordbook}
            onSubmit={handleUpdate}
            submitLabel={t.common.update}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title={wordbook.name}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant={showReading ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowReading((v) => !v)}
            >
              {t.words.showReading}
            </Button>
            <Button
              variant={showMeaning ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowMeaning((v) => !v)}
            >
              {t.words.showMeaning}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              data-testid="wordbook-edit-button"
            >
              {t.common.edit}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={handleDelete}
              data-testid="wordbook-delete-button"
            >
              {t.common.delete}
            </Button>
          </div>
        }
      />

      <div className="space-y-4 p-4">
        {wordbook.description && (
          <div className="text-sm text-muted-foreground">{wordbook.description}</div>
        )}

        {words.length > 0 && (
          <Button
            className="w-full"
            onClick={() => router.push(`/quiz?wordbookId=${id}`)}
            data-testid="wordbook-start-quiz"
          >
            {t.wordbooks.startQuiz}
          </Button>
        )}

        {words.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            {t.wordbooks.noWords}
          </div>
        ) : (
          <div className="space-y-2">
            {words.map((word) => (
              <SwipeableWordCard
                key={word.id}
                word={word}
                showReading={showReading}
                showMeaning={showMeaning}
                actionIcon={<RemoveIcon className="h-5 w-5" />}
                actionLabel={t.wordbooks.removeWord}
                actionColor="bg-red-500"
                onAction={handleRemoveWord}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function RemoveIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
