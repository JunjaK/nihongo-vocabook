'use client';

import { useCallback, useState } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useTranslation } from '@/lib/i18n';
import type { Kanji } from '@/types/kanji';
import { KanjiCardContent } from './kanji-card-content';

interface KanjiCharProps {
  char: string;
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; data: Kanji | null };

const cache = new Map<string, Kanji | null>();
const inflight = new Map<string, Promise<Kanji | null>>();

async function fetchKanji(char: string, locale: string): Promise<Kanji | null> {
  const cacheKey = `${char}:${locale}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(
        `/api/kanji?c=${encodeURIComponent(char)}&locale=${locale}`,
        { cache: 'no-store' },
      );
      if (res.status === 404) {
        cache.set(cacheKey, null);
        return null;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as { data: Kanji | null };
      const data = json.data ?? null;
      cache.set(cacheKey, data);
      return data;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, p);
  return p;
}

export function KanjiChar({ char }: KanjiCharProps) {
  const { locale } = useTranslation();
  const isFinePointer = useMediaQuery('(pointer: fine)');
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  const triggerLoad = useCallback(() => {
    if (state.status !== 'idle') return;
    setState({ status: 'loading' });
    fetchKanji(char, locale).then((data) => {
      setState({ status: 'loaded', data });
    });
  }, [char, locale, state.status]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) triggerLoad();
    },
    [triggerLoad],
  );

  const triggerClasses =
    'cursor-help underline decoration-dotted decoration-text-tertiary/60 underline-offset-[3px] transition-colors hover:decoration-primary';

  const content = (
    <KanjiCardContent
      character={char}
      data={state.status === 'loaded' ? state.data : null}
      loading={state.status === 'loading'}
    />
  );

  if (isFinePointer) {
    return (
      <HoverCard openDelay={200} onOpenChange={handleOpenChange}>
        <HoverCardTrigger asChild>
          <span className={triggerClasses} onClick={triggerLoad}>
            {char}
          </span>
        </HoverCardTrigger>
        <HoverCardContent className="w-72" align="start">
          {content}
        </HoverCardContent>
      </HoverCard>
    );
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <span className={triggerClasses}>{char}</span>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        {content}
      </PopoverContent>
    </Popover>
  );
}
