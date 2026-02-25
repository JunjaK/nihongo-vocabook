'use client';

import Link from 'next/link';
import { ChevronRight } from '@/components/ui/icons';
import { useTranslation } from '@/lib/i18n';
import type { WordbookWithCount } from '@/types/wordbook';

interface WordbookCardProps {
  wordbook: WordbookWithCount;
  subscribed?: boolean;
}

export function WordbookCard({ wordbook, subscribed }: WordbookCardProps) {
  const { t } = useTranslation();

  return (
    <Link
      href={`/wordbooks/${wordbook.id}`}
      className="flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:bg-accent"
      data-testid="wordbook-card"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{wordbook.name}</span>
          {subscribed && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {t.wordbooks.subscribedWordbooks}
            </span>
          )}
        </div>
        {wordbook.description && (
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            {wordbook.description}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
        <span>{t.wordbooks.wordCount(wordbook.wordCount)}</span>
        <ChevronRight className="size-4" />
      </div>
    </Link>
  );
}
