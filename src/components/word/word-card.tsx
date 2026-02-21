'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Word } from '@/types/word';

interface WordCardProps {
  word: Word;
  showReading: boolean;
  showMeaning: boolean;
}

export function WordCard({ word, showReading, showMeaning }: WordCardProps) {
  const [revealed, setRevealed] = useState(false);

  const readingVisible = showReading || revealed;
  const meaningVisible = showMeaning || revealed;

  return (
    <div className="flex items-center rounded-lg border transition-colors hover:bg-accent">
      <Link
        href={`/words/${word.id}`}
        className="min-w-0 flex-1 p-4"
        data-testid="word-card"
      >
        <div className="text-xl font-bold">{word.term}</div>
        {readingVisible && (
          <div className="text-sm text-muted-foreground">{word.reading}</div>
        )}
        {meaningVisible && (
          <div className="mt-1 text-base text-primary">{word.meaning}</div>
        )}
      </Link>
      {(!showReading || !showMeaning) && (
        <button
          onClick={(e) => {
            e.preventDefault();
            setRevealed((v) => !v);
          }}
          className="shrink-0 p-4 text-muted-foreground hover:text-foreground"
          data-testid="word-card-reveal"
          aria-label={revealed ? 'Hide details' : 'Reveal details'}
        >
          {revealed ? (
            <EyeOffIcon className="h-5 w-5" />
          ) : (
            <EyeIcon className="h-5 w-5" />
          )}
        </button>
      )}
    </div>
  );
}

function EyeIcon({ className }: { className?: string }) {
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
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
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
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}
