'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Share2, FolderOpen } from '@/components/ui/icons';
import { Header } from '@/components/layout/header';
import { ListToolbar } from '@/components/layout/list-toolbar';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
            <Button variant="ghost" size="icon-sm" data-testid="wordbooks-browse-button" aria-label="Browse shared wordbooks">
              <Share2 className="size-5" />
            </Button>
          </Link>
        }
      />

      <Tabs defaultValue="owned" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="shrink-0 px-5 pt-2 pb-2">
          <TabsList className="!h-11 w-full gap-0.5 rounded-md bg-secondary p-1 dark:bg-border">
            <TabsTrigger value="owned" className="h-full flex-1 rounded-sm text-[13px] font-medium data-[state=active]:shadow-sm dark:data-[state=active]:!bg-secondary">
              {t.wordbooks.myWordbooks}
            </TabsTrigger>
            <TabsTrigger value="subscribed" className="h-full flex-1 rounded-sm text-[13px] font-medium data-[state=active]:shadow-sm dark:data-[state=active]:!bg-secondary">
              {t.wordbooks.subscribedWordbooks}
            </TabsTrigger>
          </TabsList>
        </div>

        <ListToolbar
          searchValue={searchInput}
          onSearchChange={setSearchInput}
          onSearchSubmit={handleSearch}
          onSearchClear={handleSearchClear}
          searchPlaceholder={t.wordbooks.searchPlaceholder}
          sortValue={sortOrder}
          sortOptions={[
            { value: 'newest', label: t.wordbooks.sortByNewest },
            { value: 'name', label: t.wordbooks.sortByName },
          ]}
          onSortChange={(v) => setSortOrder(v as SortOrder)}
        />

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
                  <div className="space-y-3 px-5 pt-2 pb-3">
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
                  <div className="space-y-3 px-5 pt-2 pb-3">
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
