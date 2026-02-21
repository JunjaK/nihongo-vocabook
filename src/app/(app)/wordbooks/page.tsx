'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { WordbookCard } from '@/components/wordbook/wordbook-card';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import type { WordbookWithCount } from '@/types/wordbook';

export default function WordbooksPage() {
  const repo = useRepository();
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const [wordbooks, setWordbooks] = useState<WordbookWithCount[]>([]);
  const [subscribed, setSubscribed] = useState<WordbookWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWordbooks = useCallback(async () => {
    setLoading(true);
    try {
      const [owned, subs] = await Promise.all([
        repo.wordbooks.getAll(),
        user ? repo.wordbooks.getSubscribed() : Promise.resolve([]),
      ]);
      setWordbooks(owned);
      setSubscribed(subs);
    } finally {
      setLoading(false);
    }
  }, [repo, user]);

  useEffect(() => {
    loadWordbooks();
  }, [loadWordbooks]);

  const isEmpty = wordbooks.length === 0 && subscribed.length === 0;

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
      ) : isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          {t.wordbooks.noWordbooksYet}
        </div>
      ) : (
        <div className="space-y-6 p-4">
          {wordbooks.length > 0 && (
            <section>
              {subscribed.length > 0 && (
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                  {t.wordbooks.myWordbooks}
                </h2>
              )}
              <div className="space-y-2">
                {wordbooks.map((wb) => (
                  <WordbookCard key={wb.id} wordbook={wb} />
                ))}
              </div>
            </section>
          )}

          {subscribed.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {t.wordbooks.subscribedWordbooks}
              </h2>
              <div className="space-y-2">
                {subscribed.map((wb) => (
                  <WordbookCard key={wb.id} wordbook={wb} subscribed />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
