'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { Button } from '@/components/ui/button';
import { WordCardWithMenu } from '@/components/word/swipeable-word-card';
import { WordbookForm } from '@/components/wordbook/wordbook-form';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
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
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const [wordbook, setWordbook] = useState<Wordbook | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');

  const isOwned = wordbook && user && wordbook.userId === user.id;
  const isSubscribed = wordbook && user && wordbook.userId !== user.id;

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

  const handleUpdate = async (values: { name: string; description: string | null; isShared?: boolean; tags?: string[] }) => {
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

  const handleUnsubscribe = async () => {
    await repo.wordbooks.unsubscribe(id);
    toast.success(t.wordbooks.unsubscribed);
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
        <div className="py-8 text-center text-muted-foreground">{t.common.loading}</div>
      </>
    );
  }

  if (!wordbook) {
    return (
      <>
        <Header title={t.wordbooks.title} showBack />
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
          title={t.wordbooks.editWordbook}
          showBack
          actions={
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t.common.cancel}
            </Button>
          }
        />
        <WordbookForm
          initialValues={{
            name: wordbook.name,
            description: wordbook.description,
            isShared: wordbook.isShared,
            tags: wordbook.tags,
          }}
          onSubmit={handleUpdate}
          submitLabel={t.common.update}
          showShareToggle={!!user}
        />
      </>
    );
  }

  return (
    <>
      <Header
        title={wordbook.name}
        showBack
        actions={
          isSubscribed ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={handleUnsubscribe}
              data-testid="wordbook-unsubscribe-button"
            >
              {t.wordbooks.unsubscribe}
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Link href={`/wordbooks/${id}/add-words`}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-testid="wordbook-add-words-button"
                  aria-label={t.wordbooks.addWords}
                >
                  <Plus className="size-5" />
                </Button>
              </Link>
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
          )
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
        <div className="animate-fade-in flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          {t.wordbooks.noWords}
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {wordbook.description && (
              <div className="animate-fade-in mb-4 text-sm text-muted-foreground">{wordbook.description}</div>
            )}

            {isSubscribed && (
              <div className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                {t.wordbooks.readOnly}
              </div>
            )}

            {filteredWords.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                {t.words.noWords}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredWords.map((word, i) => (
                  <div
                    key={word.id}
                    className="animate-stagger"
                    style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
                  >
                    <WordCardWithMenu
                      word={word}
                      showReading={showReading}
                      showMeaning={showMeaning}
                      actions={
                        isOwned
                          ? [
                              {
                                label: t.wordDetail.markMastered,
                                onAction: handleMasterWord,
                              },
                              {
                                label: t.wordbooks.removeWord,
                                onAction: handleRemoveWord,
                                variant: 'destructive',
                              },
                            ]
                          : []
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 px-4 pb-3">
            <div className="mb-3 h-px bg-border" />
            <Button
              className="w-full"
              onClick={() =>
                router.push(
                  `/quiz?wordbookId=${id}${isSubscribed ? '&subscribed=true' : ''}`,
                )
              }
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
