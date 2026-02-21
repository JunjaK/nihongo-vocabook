'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { ImportWordbookDialog } from '@/components/wordbook/import-wordbook-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import type { SharedWordbookListItem } from '@/types/wordbook';

export default function BrowseSharedPage() {
  const repo = useRepository();
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const [items, setItems] = useState<SharedWordbookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SharedWordbookListItem | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await repo.wordbooks.browseShared();
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, [repo, user]);

  useEffect(() => {
    load();
  }, [load]);

  // Guest user: show sign-up CTA
  if (!user) {
    return (
      <>
        <Header title={t.wordbooks.findShared} showBack />
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="text-4xl">📚</div>
          <div className="mt-4 text-lg font-semibold">{t.wordbooks.loginRequired}</div>
          <div className="mt-2 text-muted-foreground">
            {t.wordbooks.loginRequiredDescription}
          </div>
        </div>
        <div className="shrink-0 bg-background px-4 pb-3">
          <div className="mb-3 h-px bg-border" />
          <div className="flex gap-2">
            <Link href="/login" className="flex-1">
              <Button className="w-full">{t.auth.signIn}</Button>
            </Link>
            <Link href="/signup" className="flex-1">
              <Button variant="outline" className="w-full">{t.auth.signUp}</Button>
            </Link>
          </div>
        </div>
      </>
    );
  }

  const systemItems = items.filter((i) => i.isSystem);
  const userItems = items.filter((i) => !i.isSystem);

  return (
    <>
      <Header title={t.wordbooks.findShared} showBack />

      {loading ? (
        <div className="p-4 py-8 text-center text-muted-foreground">
          {t.common.loading}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          {t.wordbooks.noWordbooks}
        </div>
      ) : (
        <div className="space-y-6 p-4">
          {systemItems.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {t.wordbooks.systemWordbooks}
              </h2>
              <div className="space-y-2">
                {systemItems.map((item) => (
                  <SharedWordbookCard
                    key={item.id}
                    item={item}
                    onSelect={() => setSelected(item)}
                  />
                ))}
              </div>
            </section>
          )}

          {userItems.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {t.wordbooks.sharedWordbooks}
              </h2>
              <div className="space-y-2">
                {userItems.map((item) => (
                  <SharedWordbookCard
                    key={item.id}
                    item={item}
                    onSelect={() => setSelected(item)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <ImportWordbookDialog
        wordbook={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onDone={() => {
          setSelected(null);
          load();
        }}
      />
    </>
  );
}

function SharedWordbookCard({
  item,
  onSelect,
}: {
  item: SharedWordbookListItem;
  onSelect: () => void;
}) {
  const { t } = useTranslation();

  return (
    <button
      onClick={onSelect}
      className="block w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent"
      data-testid="shared-wordbook-card"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{item.name}</span>
            {item.isSubscribed && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {t.wordbooks.subscribedWordbooks}
              </span>
            )}
          </div>
          {item.description && (
            <div className="mt-0.5 truncate text-sm text-muted-foreground">
              {item.description}
            </div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            {t.wordbooks.ownerLabel}: {item.ownerEmail}
          </div>
        </div>
        <div className="ml-4 shrink-0 text-sm text-muted-foreground">
          {t.wordbooks.wordCount(item.wordCount)}
        </div>
      </div>
    </button>
  );
}
