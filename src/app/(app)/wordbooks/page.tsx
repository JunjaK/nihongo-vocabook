'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { WordbookCard } from '@/components/wordbook/wordbook-card';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import type { WordbookWithCount } from '@/types/wordbook';

export default function WordbooksPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const [wordbooks, setWordbooks] = useState<WordbookWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWordbooks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await repo.wordbooks.getAll();
      setWordbooks(data);
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    loadWordbooks();
  }, [loadWordbooks]);

  return (
    <>
      <Header
        title={t.wordbooks.title}
        actions={
          <Link href="/wordbooks/new">
            <Button variant="ghost" size="sm" data-testid="wordbooks-add-button">
              {t.common.add}
            </Button>
          </Link>
        }
      />

      {loading ? (
        <div className="p-4 py-8 text-center text-muted-foreground">
          {t.common.loading}
        </div>
      ) : wordbooks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          {t.wordbooks.noWordbooksYet}
        </div>
      ) : (
        <div className="space-y-2 p-4">
          {wordbooks.map((wb) => (
            <WordbookCard key={wb.id} wordbook={wb} />
          ))}
        </div>
      )}
    </>
  );
}
