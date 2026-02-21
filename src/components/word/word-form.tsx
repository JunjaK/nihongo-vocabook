'use client';

import { useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { WordSearch } from './word-search';
import { useTranslation } from '@/lib/i18n';
import type { CreateWordInput, Word } from '@/types/word';

const JLPT_OPTIONS = ['N5', 'N4', 'N3', 'N2', 'N1'];

interface WordFormProps {
  initialValues?: Word;
  onSubmit: (data: CreateWordInput) => Promise<void>;
  submitLabel?: string;
}

export function WordForm({
  initialValues,
  onSubmit,
  submitLabel,
}: WordFormProps) {
  const { t } = useTranslation();
  const meaningRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState(initialValues?.term ?? '');
  const [reading, setReading] = useState(initialValues?.reading ?? '');
  const [meaning, setMeaning] = useState(initialValues?.meaning ?? '');
  const [notes, setNotes] = useState(initialValues?.notes ?? '');
  const [tags, setTags] = useState(initialValues?.tags.join(', ') ?? '');
  const [jlptLevel, setJlptLevel] = useState<string>(
    initialValues?.jlptLevel?.toString() ?? '',
  );
  const [englishRef, setEnglishRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleDictionarySelect = (entry: {
    term: string;
    reading: string;
    englishMeaning: string;
    jlptLevel: number | null;
  }) => {
    setTerm(entry.term);
    setReading(entry.reading);
    setEnglishRef(entry.englishMeaning);
    if (entry.jlptLevel) setJlptLevel(String(entry.jlptLevel));
    // Auto-focus meaning input after dictionary selection
    setTimeout(() => meaningRef.current?.focus(), 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim() || !reading.trim() || !meaning.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit({
        term: term.trim(),
        reading: reading.trim(),
        meaning: meaning.trim(),
        notes: notes.trim() || null,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        jlptLevel: jlptLevel ? Number(jlptLevel) : null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const label = submitLabel ?? t.common.save;
  const canSubmit = term.trim() && reading.trim() && meaning.trim();

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!initialValues && (
          <div>
            <Label>{t.wordForm.dictionarySearch}</Label>
            <WordSearch onSelect={handleDictionarySelect} />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="term">{t.wordForm.term}</Label>
          <Input
            id="term"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="食べる"
            required
            data-testid="word-form-term"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="reading">{t.wordForm.reading}</Label>
          <Input
            id="reading"
            value={reading}
            onChange={(e) => setReading(e.target.value)}
            placeholder="たべる"
            required
            data-testid="word-form-reading"
          />
        </div>

        {englishRef && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <span className="font-medium">{t.wordForm.english}:</span> {englishRef}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="meaning">{t.wordForm.meaning}</Label>
          <Input
            ref={meaningRef}
            id="meaning"
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            placeholder="먹다"
            required
            data-testid="word-form-meaning"
          />
        </div>

        <div className="space-y-2">
          <Label>{t.wordForm.jlptLevel}</Label>
          <Combobox
            value={jlptLevel ? `N${jlptLevel}` : null}
            onValueChange={(v) => setJlptLevel(v ? v.replace('N', '') : '')}
            items={JLPT_OPTIONS}
          >
            <ComboboxInput
              placeholder={t.wordForm.jlptNone}
              showClear
              data-testid="word-form-jlpt"
            />
            <ComboboxContent>
              <ComboboxEmpty>{t.words.noWords}</ComboboxEmpty>
              <ComboboxList>
                {(item) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tags">{t.wordForm.tags}</Label>
          <Input
            id="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="동사, 일상"
            data-testid="word-form-tags"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes">{t.wordForm.notes}</Label>
          <Input
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t.wordForm.notes}
            data-testid="word-form-notes"
          />
        </div>
      </div>

      {/* Submit button — fixed outside scroll */}
      <div className="shrink-0 bg-background px-4 pb-3">
        <div className="mb-3 h-px bg-border" />
        <Button
          type="submit"
          className="w-full"
          disabled={submitting || !canSubmit}
          data-testid="word-form-submit"
        >
          {submitting ? t.common.saving : label}
        </Button>
      </div>
    </form>
  );
}
