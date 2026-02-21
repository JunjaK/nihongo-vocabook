'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { WordSearch } from './word-search';
import { useTranslation } from '@/lib/i18n';
import type { CreateWordInput, Word } from '@/types/word';

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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
          id="meaning"
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
          placeholder="먹다"
          required
          data-testid="word-form-meaning"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="jlptLevel">{t.wordForm.jlptLevel}</Label>
        <select
          id="jlptLevel"
          value={jlptLevel}
          onChange={(e) => setJlptLevel(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
          data-testid="word-form-jlpt"
        >
          <option value="">{t.wordForm.jlptNone}</option>
          <option value="5">N5</option>
          <option value="4">N4</option>
          <option value="3">N3</option>
          <option value="2">N2</option>
          <option value="1">N1</option>
        </select>
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

      <Button
        type="submit"
        className="w-full"
        disabled={submitting || !term.trim() || !reading.trim() || !meaning.trim()}
        data-testid="word-form-submit"
      >
        {submitting ? t.common.saving : label}
      </Button>
    </form>
  );
}
