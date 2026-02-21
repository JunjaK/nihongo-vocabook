'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { LogIn } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { ImportWordbookDialog } from '@/components/wordbook/import-wordbook-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import type { SharedWordbookListItem } from '@/types/wordbook';

type SharedSort = 'imports' | 'newest' | 'name';

function sortSharedItems(items: SharedWordbookListItem[], sort: SharedSort): SharedWordbookListItem[] {
  return [...items].sort((a, b) => {
    if (sort === 'imports') return b.importCount - a.importCount || b.createdAt.getTime() - a.createdAt.getTime();
    if (sort === 'newest') return b.createdAt.getTime() - a.createdAt.getTime();
    return a.name.localeCompare(b.name);
  });
}

export default function BrowseSharedPage() {
  const repo = useRepository();
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();
  const [items, setItems] = useState<SharedWordbookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SharedWordbookListItem | null>(null);
  const [sortBy, setSortBy] = useState<SharedSort>('imports');
  const [tagFilter, setTagFilter] = useState('');

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
          <LogIn className="animate-scale-in size-10 text-primary" />
          <div className="animate-slide-up mt-4 text-lg font-semibold" style={{ animationDelay: '100ms' }}>{t.wordbooks.loginRequired}</div>
          <div className="animate-slide-up mt-2 text-muted-foreground" style={{ animationDelay: '200ms' }}>
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
  const filteredUserItems = items.filter((i) => {
    if (i.isSystem) return false;
    if (tagFilter) {
      return i.tags.some((tag) => tag.toLowerCase().includes(tagFilter.toLowerCase()));
    }
    return true;
  });
  const userItems = sortSharedItems(filteredUserItems, sortBy);

  return (
    <>
      <Header title={t.wordbooks.findShared} showBack />

      {loading ? (
        <div className="py-8 text-center text-muted-foreground">
          {t.common.loading}
        </div>
      ) : items.length === 0 ? (
        <div className="animate-fade-in flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          {t.wordbooks.noWordbooks}
        </div>
      ) : (
        <div className="space-y-6 p-4">
          {systemItems.length > 0 && (
            <section className="animate-fade-in">
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {t.wordbooks.defaultWordbooks}
              </h2>
              <div className="space-y-2">
                {systemItems.map((item, i) => (
                  <div
                    key={item.id}
                    className="animate-stagger"
                    style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
                  >
                    <SharedWordbookCard
                      item={item}
                      onSelect={() => setSelected(item)}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {(filteredUserItems.length > 0 || tagFilter) && (
            <section className="animate-fade-in" style={{ animationDelay: '100ms' }}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {t.wordbooks.sharedWordbooks}
              </h2>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {[
                  { value: 'imports' as const, label: t.wordbooks.sortByImports },
                  { value: 'newest' as const, label: t.wordbooks.sortByNewest },
                  { value: 'name' as const, label: t.wordbooks.sortByName },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSortBy(opt.value)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      sortBy === opt.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <input
                  type="text"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  placeholder={t.wordbooks.tagsPlaceholder}
                  className="h-7 rounded-full border bg-background px-3 text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-2">
                {userItems.map((item, i) => (
                  <div
                    key={item.id}
                    className="animate-stagger"
                    style={{ '--stagger': Math.min(i + systemItems.length, 15) } as React.CSSProperties}
                  >
                    <SharedWordbookCard
                      item={item}
                      onSelect={() => setSelected(item)}
                    />
                  </div>
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
          {item.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{t.wordbooks.ownerLabel}: {item.ownerEmail}</span>
            {item.importCount > 0 && (
              <span>{t.wordbooks.importCount(item.importCount)}</span>
            )}
          </div>
        </div>
        <div className="ml-4 shrink-0 text-sm text-muted-foreground">
          {t.wordbooks.wordCount(item.wordCount)}
        </div>
      </div>
    </button>
  );
}
