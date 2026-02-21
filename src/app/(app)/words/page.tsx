'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SwipeableWordCard } from '@/components/word/swipeable-word-card';
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

  const handleReset = () => {
    setSearchInput('');
    setAppliedQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
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
          <div className="flex items-center gap-1">
            <Button
              variant={showReading ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowReading((v) => !v)}
              data-testid="words-toggle-reading"
            >
              {t.words.showReading}
            </Button>
            <Button
              variant={showMeaning ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowMeaning((v) => !v)}
              data-testid="words-toggle-meaning"
            >
              {t.words.showMeaning}
            </Button>
            <Link href="/words/new">
              <Button variant="ghost" size="sm" data-testid="words-add-button">
                {t.common.add}
              </Button>
            </Link>
          </div>
        }
      />

      <div className="space-y-4 p-4">
        <div className="flex gap-2">
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.words.searchPlaceholder}
            data-testid="words-search-input"
          />
          <Button
            onClick={handleSearch}
            variant="secondary"
            data-testid="words-search-button"
          >
            {t.common.search}
          </Button>
          {appliedQuery && (
            <Button onClick={handleReset} variant="ghost" size="sm">
              {t.common.clear}
            </Button>
          )}
        </div>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            {t.common.loading}
          </div>
        ) : words.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            {appliedQuery ? t.words.noWords : t.words.noWordsYet}
          </div>
        ) : (
          <div className="space-y-2">
            {words.map((word) => (
              <SwipeableWordCard
                key={word.id}
                word={word}
                showReading={showReading}
                showMeaning={showMeaning}
                actionIcon={<CheckIcon className="h-5 w-5" />}
                actionLabel={t.wordDetail.markMastered}
                actionColor="bg-green-500"
                onAction={handleMaster}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function CheckIcon({ className }: { className?: string }) {
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
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
