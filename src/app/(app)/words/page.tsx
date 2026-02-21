'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { Button } from '@/components/ui/button';
import { WordCardWithMenu } from '@/components/word/swipeable-word-card';
import { AddToWordbookDialog } from '@/components/wordbook/add-to-wordbook-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { Word } from '@/types/word';

export default function WordsPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const [words, setWords] = useState<Word[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);
  const [wordbookDialogWordId, setWordbookDialogWordId] = useState<string | null>(null);

  const loadWords = useCallback(async () => {
    setLoading(true);
    try {
      if (appliedQuery) {
        const data = await repo.words.search(appliedQuery);
        setWords(data.filter((w) => !w.mastered));
      } else {
        const data = await repo.words.getNonMastered();
        setWords(data);
      }
    } finally {
      setLoading(false);
    }
  }, [repo, appliedQuery]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  const handleSearch = () => {
    setAppliedQuery(searchInput.trim());
  };

  const handleSearchClear = () => {
    setSearchInput('');
    setAppliedQuery('');
  };

  const handleMaster = async (wordId: string) => {
    await repo.words.setMastered(wordId, true);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    toast.success(t.masteredPage.wordMastered);
  };

  return (
    <>
      <Header
        title={t.words.title}
        actions={
          <Link href="/words/new">
            <Button variant="ghost" size="sm" data-testid="words-add-button">
              {t.common.add}
            </Button>
          </Link>
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
      />

      {loading ? (
        <div className="p-4 py-8 text-center text-muted-foreground">
          {t.common.loading}
        </div>
      ) : words.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          {appliedQuery ? t.words.noWords : t.words.noWordsYet}
        </div>
      ) : (
        <div className="space-y-2 p-4">
          {words.map((word) => (
            <WordCardWithMenu
              key={word.id}
              word={word}
              showReading={showReading}
              showMeaning={showMeaning}
              actions={[
                {
                  label: t.wordDetail.markMastered,
                  onAction: handleMaster,
                },
                {
                  label: t.wordDetail.addToWordbook,
                  onAction: (id) => setWordbookDialogWordId(id),
                },
              ]}
            />
          ))}
        </div>
      )}

      {wordbookDialogWordId && (
        <AddToWordbookDialog
          wordId={wordbookDialogWordId}
          open
          onClose={() => setWordbookDialogWordId(null)}
        />
      )}
    </>
  );
}
