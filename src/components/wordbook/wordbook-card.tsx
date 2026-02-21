'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import type { WordbookWithCount } from '@/types/wordbook';

interface WordbookCardProps {
  wordbook: WordbookWithCount;
}

export function WordbookCard({ wordbook }: WordbookCardProps) {
  const { t } = useTranslation();

  return (
    <Link
      href={`/wordbooks/${wordbook.id}`}
      className="block rounded-lg border p-4 transition-colors hover:bg-accent"
      data-testid="wordbook-card"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">{wordbook.name}</div>
          {wordbook.description && (
            <div className="mt-0.5 truncate text-sm text-muted-foreground">
              {wordbook.description}
            </div>
          )}
        </div>
        <div className="ml-4 shrink-0 text-sm text-muted-foreground">
          {t.wordbooks.wordCount(wordbook.wordCount)}
        </div>
      </div>
    </Link>
  );
}
