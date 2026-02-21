'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { Button } from '@/components/ui/button';
import { WordCardWithMenu } from '@/components/word/swipeable-word-card';
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
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');

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

  const handleMasterWord = async (wordId: string) => {
    await repo.words.setMastered(wordId, true);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    toast.success(t.masteredPage.wordMastered);
  };

  const handleRemoveWord = async (wordId: string) => {
    await repo.wordbooks.removeWord(id, wordId);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    toast.success(t.wordbooks.wordRemoved);
  };

  const handleSearch = () => {
    setAppliedQuery(searchInput.trim());
  };

  const handleSearchClear = () => {
    setSearchInput('');
    setAppliedQuery('');
  };

  const filteredWords = appliedQuery
    ? words.filter((w) => {
        const lower = appliedQuery.toLowerCase();
        return (
          w.term.toLowerCase().includes(lower) ||
          w.reading.toLowerCase().includes(lower) ||
          w.meaning.toLowerCase().includes(lower)
        );
      })
    : words;

  if (loading) {
    return (
      <>
        <Header title={t.wordbooks.title} showBack />
        <div className="p-4 text-center text-muted-foreground">{t.common.loading}</div>
      </>
    );
  }

  if (!wordbook) {
    return (
      <>
        <Header title={t.wordbooks.title} showBack />
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
        showBack
        actions={
          <div className="flex items-center gap-1">
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

      {words.length > 0 && (
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
        />
      )}

      {words.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          {t.wordbooks.noWords}
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {wordbook.description && (
              <div className="mb-4 text-sm text-muted-foreground">{wordbook.description}</div>
            )}

            {filteredWords.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                {t.words.noWords}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredWords.map((word) => (
                  <WordCardWithMenu
                    key={word.id}
                    word={word}
                    showReading={showReading}
                    showMeaning={showMeaning}
                    actions={[
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
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 px-4 pb-3">
            <div className="mx-4 mb-3 h-px bg-border" />
            <Button
              className="w-full"
              onClick={() => router.push(`/quiz?wordbookId=${id}`)}
              data-testid="wordbook-start-quiz"
            >
              {t.wordbooks.startQuiz}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
