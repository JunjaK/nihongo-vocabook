'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FolderOpen, LogIn } from '@/components/ui/icons';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
        <div className="shrink-0 px-5 pt-2 pb-2">
          <TabsList className="!h-11 w-full gap-0.5 rounded-md bg-secondary p-1 dark:bg-border">
            <TabsTrigger value="user" className="h-full flex-1 rounded-sm text-[13px] font-medium data-[state=active]:shadow-sm dark:data-[state=active]:!bg-secondary" data-testid="browse-tab-user">
              {t.wordbooks.tabUserWordbooks}
            </TabsTrigger>
            <TabsTrigger value="system" className="h-full flex-1 rounded-sm text-[13px] font-medium data-[state=active]:shadow-sm dark:data-[state=active]:!bg-secondary" data-testid="browse-tab-system">
              {t.wordbooks.tabSystemWordbooks}
            </TabsTrigger>
          </TabsList>
        </div>

        <ListToolbar
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          onSearchSubmit={handleSearch}
          onSearchClear={handleSearchClear}
          searchPlaceholder={t.wordbooks.searchPlaceholder}
          sortValue={sortBy}
          sortOptions={[
            { value: 'imports', label: t.wordbooks.sortByImports },
            { value: 'newest', label: t.wordbooks.sortByNewest },
            { value: 'name', label: t.wordbooks.sortByName },
          ]}
          onSortChange={(v) => setSortBy(v as SharedSort)}
        />

        {loading ? (
          <div className="animate-page flex-1 space-y-2 overflow-y-auto px-4 pt-2">
            {Array.from({ length: 20 }).map((_, i) => (
              <Skeleton key={i} className="h-[48px] w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <TabsContent value="user" className="flex min-h-0 flex-1 flex-col">
              {userItems.length === 0 ? (
                <div className={emptyState}>
                  <FolderOpen className={emptyIcon} />
                  <div className="font-medium">
                    {appliedQuery ? t.wordbooks.noWordbooks : t.wordbooks.noSharedWordbooks}
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className="space-y-3 px-5 pt-2 pb-3">
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

            <TabsContent value="system" className="flex min-h-0 flex-1 flex-col">
              {systemItems.length === 0 ? (
                <div className={emptyState}>
                  <FolderOpen className={emptyIcon} />
                  <div className="font-medium">{t.wordbooks.noWordbooks}</div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className="space-y-3 px-5 pt-2 pb-3">
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
                </div>
              )}
            </TabsContent>
          </>
        )}
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
      className="flex w-full flex-col gap-3 rounded-lg border border-secondary bg-card p-4 text-left transition-colors active:bg-accent/50"
      data-testid="shared-wordbook-card"
    >
      {/* Top row: title + count badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-title-sm font-semibold">{item.name}</span>
          {item.isSubscribed && (
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-overline font-medium text-primary">
              {t.wordbooks.subscribedWordbooks}
            </span>
          )}
        </div>
        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-badge font-medium text-muted-foreground">
          {t.wordbooks.wordCount(item.wordCount)}
        </span>
      </div>
      {/* Tags / description */}
      <div className="flex min-w-0 gap-1.5 overflow-hidden">
        {item.tags && item.tags.length > 0 ? (
          item.tags.map((tag) => (
            <span
              key={tag}
              className="shrink-0 rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
            >
              {tag}
            </span>
          ))
        ) : item.description ? (
          <span className="truncate text-xs text-muted-foreground">{item.description}</span>
        ) : (
          <span className="text-xs text-text-tertiary">{t.wordDetail.noTags}</span>
        )}
      </div>
      {/* Owner info */}
      <div className="text-overline text-muted-foreground/70">
        {t.wordbooks.ownerLabel}: {item.ownerEmail}
        {item.importCount > 0 && ` · ${t.wordbooks.importCount(item.importCount)}`}
      </div>
    </button>
  );
}
