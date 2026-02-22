'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Share2, FolderOpen } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
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
  const loadStart = useRef(0);

  const loadWordbooks = useCallback(async () => {
    setLoading(true);
    loadStart.current = Date.now();
    try {
      const [owned, subs] = await Promise.all([
        repo.wordbooks.getAll(),
        user ? repo.wordbooks.getSubscribed() : Promise.resolve([]),
      ]);
      setWordbooks(owned);
      setSubscribed(subs);
    } finally {
      const remaining = 300 - (Date.now() - loadStart.current);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      setLoading(false);
    }
  }, [repo, user]);

  useEffect(() => {
    loadWordbooks();
  }, [loadWordbooks]);

  const isEmpty = wordbooks.length === 0 && subscribed.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        title={t.wordbooks.title}
        actions={
          <Link href="/wordbooks/browse">
            <Button variant="ghost" size="icon-sm" data-testid="wordbooks-browse-button" aria-label="Browse shared">
              <Share2 className="size-5" />
            </Button>
          </Link>
        }
      />

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner className="size-8" />
          {t.common.loading}
        </div>
      ) : isEmpty ? (
        <div className="animate-fade-in flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
          <FolderOpen className="mb-3 size-10 text-muted-foreground/50" />
          <div className="font-medium">{t.wordbooks.noWordbooksYet}</div>
          <div className="mt-1 text-sm">{t.wordbooks.noWordbooksYetHint}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6 p-4">
            {wordbooks.length > 0 && (
              <section className="animate-fade-in">
                {subscribed.length > 0 && (
                  <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                    {t.wordbooks.myWordbooks}
                  </h2>
                )}
                <div className="space-y-2">
                  {wordbooks.map((wb, i) => (
                    <div
                      key={wb.id}
                      className="animate-stagger"
                      style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
                    >
                      <WordbookCard wordbook={wb} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {subscribed.length > 0 && (
              <section className="animate-fade-in" style={{ animationDelay: '100ms' }}>
                <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                  {t.wordbooks.subscribedWordbooks}
                </h2>
                <div className="space-y-2">
                  {subscribed.map((wb, i) => (
                    <div
                      key={wb.id}
                      className="animate-stagger"
                      style={{ '--stagger': Math.min(i + wordbooks.length, 15) } as React.CSSProperties}
                    >
                      <WordbookCard wordbook={wb} subscribed />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {!loading && (
        <div className="shrink-0 bg-background px-4 pb-3">
          <div className="mb-3 h-px bg-border" />
          <Link href="/wordbooks/create">
            <Button className="w-full" data-testid="wordbooks-create-button">
              {t.wordbooks.createWordbook}
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
