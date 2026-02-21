'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { bind, unbind, toKana } from 'wanakana';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { searchDictionary } from '@/lib/dictionary/jisho';
import { useTranslation } from '@/lib/i18n';
import type { DictionaryEntry } from '@/types/word';

interface WordSearchProps {
  onSelect: (entry: {
    term: string;
    reading: string;
    englishMeaning: string;
    jlptLevel: number | null;
  }) => void;
}

export function WordSearch({ onSelect }: WordSearchProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    bind(el, { IMEMode: 'toHiragana' });
    return () => unbind(el);
  }, []);

  const handleSearch = useCallback(async () => {
    const rawValue = inputRef.current?.value ?? '';
    const trimmed = rawValue.trim();
    if (!trimmed) return;

    setQuery(rawValue);
    setLoading(true);
    try {
      const kanaQuery = toKana(trimmed);
      const data = await searchDictionary(kanaQuery || trimmed);
      setResults(data.slice(0, 10));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  const handleSelect = (entry: DictionaryEntry) => {
    const jp = entry.japanese[0];
    const sense = entry.senses[0];
    const jlptMatch = entry.jlptLevels[0]?.match(/\d/);

    onSelect({
      term: jp?.word ?? jp?.reading ?? '',
      reading: jp?.reading ?? '',
      englishMeaning: sense?.englishDefinitions.join(', ') ?? '',
      jlptLevel: jlptMatch ? Number(jlptMatch[0]) : null,
    });

    setResults([]);
    setQuery('');
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.wordForm.searchPlaceholder}
          data-testid="word-search-input"
        />
        <Button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          data-testid="word-search-button"
        >
          {loading ? '...' : t.common.search}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="rounded-lg border">
          {results.map((entry, i) => {
            const jp = entry.japanese[0];
            const sense = entry.senses[0];
            return (
              <button
                key={`${entry.slug}-${i}`}
                onClick={() => handleSelect(entry)}
                className="flex w-full items-start gap-3 border-b p-3 text-left last:border-b-0 hover:bg-accent"
                data-testid={`word-search-result-${i}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-bold">
                    {jp?.word ?? jp?.reading}
                    {jp?.word && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {jp.reading}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {sense?.englishDefinitions.slice(0, 3).join(', ')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {sense?.partsOfSpeech.join(', ')}
                  </div>
                </div>
                {entry.jlptLevels[0] && (
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs">
                    {entry.jlptLevels[0].toUpperCase()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
