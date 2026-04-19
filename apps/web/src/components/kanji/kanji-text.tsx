'use client';

import { Fragment } from 'react';
import { isKanji } from '@/lib/ruby';
import { KanjiChar } from './kanji-char';

interface KanjiTextProps {
  text: string;
  className?: string;
}

export function KanjiText({ text, className }: KanjiTextProps) {
  const chars = Array.from(text);

  return (
    <span className={className}>
      {chars.map((ch, idx) =>
        isKanji(ch) ? (
          <KanjiChar key={`${ch}-${idx}`} char={ch} />
        ) : (
          <Fragment key={`t-${idx}`}>{ch}</Fragment>
        ),
      )}
    </span>
  );
}
