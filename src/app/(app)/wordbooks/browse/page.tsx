'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FolderOpen, LogIn, Search, X } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SortDropdown } from '@/components/ui/sort-dropdown';
import { ImportWordbookDialog } from '@/components/wordbook/import-wordbook-dialog';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { useSearch } from '@/hooks/use-search';
import {
  bottomBar,
  bottomSep,
  emptyState,
  emptyIcon,
  inlineSep,
  toolbarRow,
  listContainer,
} from '@/lib/styles';
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
  const authLoading = useAuthStore((s) => s.loading);
  const { t } = useTranslation();

  const [items, setItems] = useState<SharedWordbookListItem[]>([]);
  const [selected, setSelected] = useState<SharedWordbookListItem | null>(null);
  const [sortBy, setSortBy] = useState<SharedSort>('imports');

  const { searchInput, appliedQuery, setSearchInput, handleSearch, handleSearchClear } = useSearch();

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const [loading, reload] = useLoader(async () => {
    if (!user) return true; // no user → skip delay, just set loading false
    const data = await repo.wordbooks.browseShared();
    setItems(data);
  }, [repo, user], { skip: authLoading });

  // Guest user: show sign-up CTA (wait for auth to resolve first)
  if (!authLoading && !user) {
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
        <div className={bottomBar}>
          <div className={bottomSep} />
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

      <Tabs defaultValue="user" className="flex min-h-0 flex-1 flex-col gap-0">
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

        <TabsContent value="user" className="flex min-h-0 flex-1 flex-col">
          {/* Search + sort toolbar */}
          <div className={toolbarRow}>
            <div className="relative flex-1">
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
            <SortDropdown
              value={sortBy}
              options={[
                { value: 'imports', label: t.wordbooks.sortByImports },
                { value: 'newest', label: t.wordbooks.sortByNewest },
                { value: 'name', label: t.wordbooks.sortByName },
              ]}
              onChange={(v) => setSortBy(v as SharedSort)}
            />
          </div>
          <div className={inlineSep} />

          {loading ? (
            <div className="animate-page flex-1 space-y-2 overflow-y-auto px-4 pt-2">
              {Array.from({ length: 20 }).map((_, i) => (
                <Skeleton key={i} className="h-[88px] w-full rounded-lg" />
              ))}
            </div>
          ) : userItems.length === 0 ? (
            <div className={emptyState}>
              <FolderOpen className={emptyIcon} />
              <div className="font-medium">
                {appliedQuery ? t.wordbooks.noWordbooks : t.wordbooks.noSharedWordbooks}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className={`animate-fade-in ${listContainer}`}>
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
            </div>
          )}
        </TabsContent>

        <TabsContent value="system" className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="animate-page flex-1 space-y-2 overflow-y-auto px-4 pt-2">
              {Array.from({ length: 20 }).map((_, i) => (
                <Skeleton key={i} className="h-[88px] w-full rounded-lg" />
              ))}
            </div>
          ) : systemItems.length === 0 ? (
            <div className={emptyState}>
              <FolderOpen className={emptyIcon} />
              <div className="font-medium">{t.wordbooks.noWordbooks}</div>
            </div>
          ) : (
            <div className={`animate-fade-in ${listContainer}`}>
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
          )}
        </TabsContent>
      </Tabs>

      <ImportWordbookDialog
        wordbook={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        onDone={() => {
          setSelected(null);
          reload();
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
