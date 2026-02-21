'use client';

import Link from 'next/link';
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
      className="block rounded-lg border p-4 transition-colors hover:bg-accent"
      data-testid="wordbook-card"
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{wordbook.name}</span>
            {wordbook.isShared && !subscribed && (
              <ShareIcon className="h-4 w-4 text-muted-foreground" />
            )}
            {subscribed && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
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
        <div className="ml-4 shrink-0 text-sm text-muted-foreground">
          {t.wordbooks.wordCount(wordbook.wordCount)}
        </div>
      </div>
    </Link>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
