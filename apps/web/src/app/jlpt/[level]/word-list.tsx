'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Lock } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { WordCard } from '@/components/word/word-card';
import { pageWrapper, bottomBar, bottomSep } from '@/lib/styles';
import type { Word } from '@/types/word';
import type { JlptWord } from './page';

interface LevelLink {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

interface JlptWordListProps {
  level: string;
  title: string;
  headline: string;
  wordCount: string;
  words: JlptWord[];
  levelLinks: LevelLink[];
}

function toWord(w: JlptWord, i: number): Word {
  const meaning =
    w.meanings_ko && w.meanings_ko.length > 0
      ? w.meanings_ko.slice(0, 2).join(', ')
      : w.meanings.slice(0, 2).join(', ');
  const now = new Date();
  return {
    id: `jlpt-sample-${i}`,
    term: w.term,
    reading: w.reading,
    meaning,
    notes: null,
    tags: [],
    jlptLevel: null,
    priority: 2,
    mastered: false,
    masteredAt: null,
    isLeech: false,
    leechAt: null,
    isOwned: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function JlptWordList({
  level,
  title,
  headline,
  wordCount,
  words,
  levelLinks,
}: JlptWordListProps) {
  const router = useRouter();
  const [showPrompt, setShowPrompt] = useState(false);

  const wordItems = useMemo(() => words.map(toWord), [words]);

  return (
    <div className={pageWrapper}>
      {/* Header */}
      <div className="shrink-0 bg-background px-4 pt-8 pb-3">
        {/* Level badge + title */}
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            {level}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold tracking-tight">{title}</h1>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm text-muted-foreground">{headline}</p>
              <p className="shrink-0 text-xs text-muted-foreground/70">
                {wordCount}개
              </p>
            </div>
          </div>
        </div>

        {/* Level tabs — segmented control */}
        <div className="mt-3 flex rounded-lg bg-muted p-1">
          {levelLinks.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className={`flex-1 rounded-md py-1.5 text-center text-sm font-medium transition-all ${
                l.active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Scrollable word list with bottom gradient overlay */}
      <div className="relative flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="space-y-2 px-4 py-3">
            {wordItems.map((word, i) => (
              <div
                key={word.id}
                className="animate-stagger"
                style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
              >
                <WordCard
                  word={word}
                  showReading={false}
                  showMeaning={false}
                  onClick={() => setShowPrompt(true)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Gradient fade hinting at CTA below */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />
      </div>

      {/* CTA */}
      <div className={bottomBar}>
        <div className={bottomSep} />
        {!showPrompt ? (
          <Button className="w-full" onClick={() => setShowPrompt(true)}>
            더보기 — 전체 {wordCount}개 학습하기
          </Button>
        ) : (
          <div className="animate-scale-in space-y-3 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10">
              <Lock className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                전체 단어를 학습하려면 로그인하세요
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                SRS 퀴즈 · 단어장 · 이미지 OCR
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => router.push('/signup')}
              >
                회원가입
              </Button>
              <Button
                className="flex-1"
                onClick={() => router.push('/login')}
              >
                로그인
              </Button>
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="mt-3 text-center text-[11px] text-muted-foreground/50">
          &copy; 2025 NiVoca
        </p>
      </div>
    </div>
  );
}
