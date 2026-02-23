'use client';

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { searchDictionary } from '@/lib/dictionary/jisho';
import { useTranslation } from '@/lib/i18n';
import { bottomBar, bottomSep } from '@/lib/styles';
import type { DictionaryEntry } from '@/types/word';

interface WordConfirmProps {
  words: string[];
  onAdd: (data: {
    term: string;
    reading: string;
    meaning: string;
    jlptLevel: number | null;
  }) => void;
  onSkip: () => void;
  currentIndex: number;
}

export function WordConfirm({
  words,
  onAdd,
  onSkip,
  currentIndex,
}: WordConfirmProps) {
  const { t } = useTranslation();
  const currentWord = words[currentIndex];
  const [results, setResults] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(false);

  const [term, setTerm] = useState(currentWord);
  const [reading, setReading] = useState('');
  const [meaning, setMeaning] = useState('');
  const [jlptLevel, setJlptLevel] = useState<number | null>(null);

  const doSearch = useCallback(async (query: string) => {
    setLoading(true);
    setSelected(false);
    setTerm(query);
    setReading('');
    setMeaning('');
    setJlptLevel(null);
    try {
      const data = await searchDictionary(query);
      setResults(data.slice(0, 5));
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    doSearch(currentWord);
  }, [currentWord, doSearch]);

  const handleSelect = (entry: DictionaryEntry) => {
    const jp = entry.japanese[0];
    const sense = entry.senses[0];
    const jlptMatch = entry.jlptLevels[0]?.match(/\d/);

    setTerm(jp?.word ?? jp?.reading ?? currentWord);
    setReading(jp?.reading ?? '');
    setMeaning('');
    setJlptLevel(jlptMatch ? Number(jlptMatch[0]) : null);
    setSelected(true);

    // Store the english definition as reference (not direct meaning)
    const english = sense?.englishDefinitions.slice(0, 3).join(', ') ?? '';
    setMeaning(english);
  };

  const handleAdd = () => {
    if (!term.trim() || !reading.trim() || !meaning.trim()) return;
    onAdd({
      term: term.trim(),
      reading: reading.trim(),
      meaning: meaning.trim(),
      jlptLevel,
    });
  };

  const canAdd = term.trim() && reading.trim() && meaning.trim();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {/* Progress */}
        <div className="mb-4 text-sm text-muted-foreground">
          {currentIndex + 1} / {words.length}
        </div>

        <div className="mb-4 text-2xl font-bold">{currentWord}</div>

        {/* Dictionary results */}
        {loading ? (
          <div className="py-4 text-center text-muted-foreground">
            {t.scan.searchingDictionary}
          </div>
        ) : !selected && results.length > 0 ? (
          <div className="space-y-1">
            <div className="mb-2 text-sm font-medium text-muted-foreground">
              {t.scan.dictionarySearch}
            </div>
            <div className="rounded-lg border">
              {results.map((entry, i) => {
                const jp = entry.japanese[0];
                const sense = entry.senses[0];
                return (
                  <button
                    key={`${entry.slug}-${i}`}
                    onClick={() => handleSelect(entry)}
                    className="flex w-full items-start gap-3 border-b p-3 text-left last:border-b-0 hover:bg-accent"
                    data-testid={`scan-dict-result-${i}`}
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
          </div>
        ) : null}

        {/* Manual / editable fields */}
        {(selected || (!loading && results.length === 0)) && (
          <div className="animate-fade-in space-y-3">
            {!loading && results.length === 0 && (
              <div className="mb-2 text-sm text-muted-foreground">
                {t.scan.noResults} — {t.scan.manualEntry}
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="confirm-term">{t.wordForm.term}</Label>
              <Input
                id="confirm-term"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                data-testid="scan-confirm-term"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="confirm-reading">{t.wordForm.reading}</Label>
              <Input
                id="confirm-reading"
                value={reading}
                onChange={(e) => setReading(e.target.value)}
                data-testid="scan-confirm-reading"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="confirm-meaning">{t.wordForm.meaning}</Label>
              <Input
                id="confirm-meaning"
                value={meaning}
                onChange={(e) => setMeaning(e.target.value)}
                placeholder="뜻 (한국어)"
                data-testid="scan-confirm-meaning"
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom buttons */}
      <div className={bottomBar}>
        <div className={bottomSep} />
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onSkip}
            data-testid="scan-skip"
          >
            {t.scan.skip}
          </Button>
          <Button
            className="flex-1"
            disabled={!canAdd}
            onClick={handleAdd}
            data-testid="scan-add-word"
          >
            {t.scan.addWord}
          </Button>
        </div>
      </div>
    </div>
  );
}
