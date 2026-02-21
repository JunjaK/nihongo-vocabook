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

      <div className="space-y-4 p-4">
        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            {t.common.loading}
          </div>
        ) : wordbooks.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            {t.wordbooks.noWordbooksYet}
          </div>
        ) : (
          <div className="space-y-2">
            {wordbooks.map((wb) => (
              <WordbookCard key={wb.id} wordbook={wb} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
