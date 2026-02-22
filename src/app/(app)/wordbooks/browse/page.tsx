'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { LogIn, Search, X } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Header } from '@/components/layout/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');

  const loadStart = useRef(0);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadStart.current = Date.now();
    try {
      const data = await repo.wordbooks.browseShared();
      setItems(data);
    } finally {
      const remaining = 300 - (Date.now() - loadStart.current);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      setLoading(false);
    }
  }, [repo, user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = () => setAppliedQuery(searchInput.trim());
  const handleSearchClear = () => { setSearchInput(''); setAppliedQuery(''); };
  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

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
    if (appliedQuery) {
      const q = appliedQuery.toLowerCase();
      return (
        i.name.toLowerCase().includes(q) ||
        i.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    return true;
  });
  const userItems = sortSharedItems(filteredUserItems, sortBy);

  return (
    <>
      <Header title={t.wordbooks.findShared} showBack />

      {loading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <LoadingSpinner className="size-8" />
          <span className="text-sm">{t.common.loading}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="animate-fade-in flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
          {t.wordbooks.noWordbooks}
        </div>
      ) : (
        <Tabs defaultValue="user" className="flex min-h-0 flex-1 flex-col">
          <div className="animate-slide-down-fade sticky top-14 z-[9] bg-background px-4 pt-2">
            <TabsList className="w-full">
              <TabsTrigger value="user" data-testid="browse-tab-user">
                {t.wordbooks.tabUserWordbooks}
              </TabsTrigger>
              <TabsTrigger value="system" data-testid="browse-tab-system">
                {t.wordbooks.tabSystemWordbooks}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="user" className="flex-1 overflow-y-auto p-4">
            <div className="animate-fade-in space-y-3">
              {/* Search input */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t.wordbooks.searchPlaceholder}
                  className="pl-8 pr-8"
                  data-testid="browse-search-input"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={handleSearchClear}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    data-testid="browse-search-clear"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              {/* Sort pills */}
              <div className="flex flex-wrap gap-2">
                {([
                  { value: 'imports' as const, label: t.wordbooks.sortByImports },
                  { value: 'newest' as const, label: t.wordbooks.sortByNewest },
                  { value: 'name' as const, label: t.wordbooks.sortByName },
                ] as const).map((opt) => (
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
              </div>

              {/* User wordbook cards */}
              {userItems.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  {appliedQuery ? t.wordbooks.noWordbooks : t.wordbooks.noWordbooksYet}
                </div>
              ) : (
                <div className="space-y-2">
                  {userItems.map((item, i) => (
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
              )}
            </div>
          </TabsContent>

          <TabsContent value="system" className="flex-1 overflow-y-auto p-4">
            <div className="animate-fade-in space-y-2">
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
          </TabsContent>
        </Tabs>
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
