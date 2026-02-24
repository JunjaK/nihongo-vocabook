'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Share2, FolderOpen, Search, X } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SortDropdown } from '@/components/ui/sort-dropdown';
import { WordbookCard } from '@/components/wordbook/wordbook-card';
import { useRepository } from '@/lib/repository/provider';
import { useAuthStore } from '@/stores/auth-store';
import { useTranslation } from '@/lib/i18n';
import { useLoader } from '@/hooks/use-loader';
import { useSearch } from '@/hooks/use-search';
import { getListCache, setListCache } from '@/lib/list-cache';
import {
  pageWrapper,
  bottomBar,
  bottomSep,
  emptyState,
  emptyIcon,
  tabsBar,
  inlineSep,
  toolbarRow,
  listContainer,
} from '@/lib/styles';
import type { WordbookWithCount } from '@/types/wordbook';

interface WordbooksCacheData {
  owned: WordbookWithCount[];
  subscribed: WordbookWithCount[];
}

type SortOrder = 'newest' | 'name';

export default function WordbooksPage() {
  const repo = useRepository();
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.loading);
  const { t } = useTranslation();
  const [wordbooks, setWordbooks] = useState<WordbookWithCount[]>([]);
  const [subscribed, setSubscribed] = useState<WordbookWithCount[]>([]);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  const { searchInput, appliedQuery, setSearchInput, handleSearch, handleSearchClear } = useSearch();

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const [loading] = useLoader(async () => {
    const cached = getListCache<WordbooksCacheData>('wordbooks');
    if (cached) {
      setWordbooks(cached.data.owned);
      setSubscribed(cached.data.subscribed);
      return true; // skip delay — data from cache
    }
    const [owned, subs] = await Promise.all([
      repo.wordbooks.getAll(),
      user ? repo.wordbooks.getSubscribed() : Promise.resolve([]),
    ]);
    setWordbooks(owned);
    setSubscribed(subs);
    setListCache('wordbooks', { owned, subscribed: subs });
  }, [repo, user], { skip: authLoading });

  const filterAndSort = (list: WordbookWithCount[]) => {
    let result = list;
    if (appliedQuery) {
      const q = appliedQuery.toLowerCase();
      result = result.filter((wb) =>
        wb.name.toLowerCase().includes(q) ||
        (wb.tags && wb.tags.some((tag) => tag.toLowerCase().includes(q)))
      );
    }
    if (sortOrder === 'name') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    } else {
      result = [...result].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return result;
  };

  const filteredOwned = filterAndSort(wordbooks);
  const filteredSubscribed = filterAndSort(subscribed);

  return (
    <div className={pageWrapper}>
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

      <Tabs defaultValue="owned" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className={tabsBar}>
          <TabsList className="w-full">
            <TabsTrigger value="owned" className="flex-1">
              {t.wordbooks.myWordbooks}
              {wordbooks.length > 0 && (
                <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-px text-[10px] font-medium tabular-nums">
                  {wordbooks.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="subscribed" className="flex-1">
              {t.wordbooks.subscribedWordbooks}
              {subscribed.length > 0 && (
                <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-px text-[10px] font-medium tabular-nums">
                  {subscribed.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Search + Sort toolbar */}
        <div className="shrink-0">
          <div className={toolbarRow}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t.wordbooks.searchPlaceholder}
                className="pl-8 pr-8"
                data-testid="wordbooks-search-input"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={handleSearchClear}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="wordbooks-search-clear"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <SortDropdown
              value={sortOrder}
              options={[
                { value: 'newest', label: t.wordbooks.sortByNewest },
                { value: 'name', label: t.wordbooks.sortByName },
              ]}
              onChange={(v) => setSortOrder(v as SortOrder)}
            />
          </div>
          <div className={inlineSep} />
        </div>

        {loading ? (
          <div className="animate-page flex-1 space-y-2 overflow-y-auto px-4 pt-2">
            {Array.from({ length: 20 }).map((_, i) => (
              <Skeleton key={i} className="h-[48px] w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <TabsContent value="owned" className="flex min-h-0 flex-1 flex-col">
              {filteredOwned.length === 0 ? (
                <div className={emptyState}>
                  <FolderOpen className={emptyIcon} />
                  {appliedQuery ? (
                    <div className="font-medium">{t.wordbooks.noWordbooks}</div>
                  ) : (
                    <>
                      <div className="font-medium">{t.wordbooks.noWordbooksYet}</div>
                      <div className="mt-1 text-sm">{t.wordbooks.noWordbooksYetHint}</div>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className={listContainer}>
                    {filteredOwned.map((wb, i) => (
                      <div
                        key={wb.id}
                        className="animate-stagger"
                        style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
                      >
                        <WordbookCard wordbook={wb} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="subscribed" className="flex min-h-0 flex-1 flex-col">
              {filteredSubscribed.length === 0 ? (
                <div className={emptyState}>
                  <FolderOpen className={emptyIcon} />
                  <div className="font-medium">
                    {appliedQuery ? t.wordbooks.noWordbooks : t.wordbooks.noSubscribed}
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <div className={listContainer}>
                    {filteredSubscribed.map((wb, i) => (
                      <div
                        key={wb.id}
                        className="animate-stagger"
                        style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
                      >
                        <WordbookCard wordbook={wb} subscribed />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>

      <div className={bottomBar}>
        <div className={bottomSep} />
        <Link href="/wordbooks/create">
          <Button className="w-full" disabled={loading} data-testid="wordbooks-create-button">
            {t.wordbooks.createWordbook}
          </Button>
        </Link>
      </div>
    </div>
  );
}
