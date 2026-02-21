'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Flag } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { WordCardWithMenu } from '@/components/word/swipeable-word-card';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { Word } from '@/types/word';

export default function MasteredPage() {
  const router = useRouter();
  const repo = useRepository();
  const { t } = useTranslation();
  const [words, setWords] = useState<Word[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showReading, setShowReading] = useState(false);
  const [showMeaning, setShowMeaning] = useState(false);

  const loadWords = useCallback(async () => {
    setLoading(true);
    try {
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

  const handleUnmaster = async (wordId: string) => {
    await repo.words.setMastered(wordId, false);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    toast.success(t.masteredPage.wordUnmastered);
  };

  const handleDelete = async (wordId: string) => {
    if (!window.confirm(t.words.deleteConfirm)) return;
    await repo.words.delete(wordId);
    setWords((prev) => prev.filter((w) => w.id !== wordId));
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
      />

      {loading ? (
        <div className="py-8 text-center text-muted-foreground">
          {t.common.loading}
        </div>
      ) : words.length === 0 ? (
        <div className="animate-fade-in flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          <Flag className="mb-3 size-10 text-muted-foreground/50" />
          {appliedQuery ? t.words.noWords : t.masteredPage.noWords}
        </div>
      ) : (
        <div className="space-y-2 p-4">
          {words.map((word, i) => (
            <div
              key={word.id}
              className="animate-stagger"
              style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
            >
              <WordCardWithMenu
                word={word}
                showReading={showReading}
                showMeaning={showMeaning}
                actions={[
                  {
                    label: t.masteredPage.unmaster,
                    onAction: handleUnmaster,
                  },
                  {
                    label: t.common.delete,
                    onAction: handleDelete,
                    variant: 'destructive',
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
