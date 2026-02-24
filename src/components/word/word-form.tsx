'use client';

import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { bottomBar, bottomSep } from '@/lib/styles';
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

interface WordFormFooterProps {
  canSubmit: boolean;
  submitting: boolean;
}

interface WordFormProps {
  initialValues?: Word | Partial<Word>;
  onSubmit: (data: CreateWordInput) => Promise<void>;
  submitLabel?: string;
  renderFooter?: (props: WordFormFooterProps) => React.ReactNode;
  showDictionarySearch?: boolean;
}

export function WordForm({
  initialValues,
  onSubmit,
  submitLabel,
  renderFooter,
  showDictionarySearch,
}: WordFormProps) {
  const { t } = useTranslation();
  const meaningRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState(initialValues?.term ?? '');
  const [reading, setReading] = useState(initialValues?.reading ?? '');
  const [meaning, setMeaning] = useState(initialValues?.meaning ?? '');
  const [notes, setNotes] = useState(initialValues?.notes ?? '');
  const [tags, setTags] = useState<string[]>(initialValues?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [jlptLevel, setJlptLevel] = useState<string>(
    initialValues?.jlptLevel?.toString() ?? '',
  );
  const [englishRef, setEnglishRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleDictionarySelect = (entry: {
    term: string;
    reading: string;
    englishMeaning: string;
    koreanMeaning?: string;
    jlptLevel: number | null;
  }) => {
    setTerm(entry.term);
    setReading(entry.reading);
    setEnglishRef(entry.englishMeaning);
    // Pre-fill meaning with Korean when available
    if (entry.koreanMeaning) {
      setMeaning(entry.koreanMeaning);
    }
    if (entry.jlptLevel) setJlptLevel(String(entry.jlptLevel));
    // Auto-focus meaning input after dictionary selection
    setTimeout(() => meaningRef.current?.focus(), 0);
  };

  const addTag = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput('');
  };

  const removeTag = (index: number) => {
    setTags((prev) => prev.filter((_, i) => i !== index));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (tagInput.trim()) addTag(tagInput);
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim() || !reading.trim() || !meaning.trim()) return;

    setSubmitting(true);
    try {
      const finalTags = tagInput.trim()
        ? [...tags, tagInput.trim()].filter((v, i, arr) => arr.indexOf(v) === i)
        : tags;
      await onSubmit({
        term: term.trim(),
        reading: reading.trim(),
        meaning: meaning.trim(),
        notes: notes.trim() || null,
        tags: finalTags,
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
        {(showDictionarySearch ?? !initialValues) && (
          <div className="space-y-2">
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
          <Label>{t.wordForm.tags}</Label>
          <div
            className="border-input focus-within:border-ring focus-within:ring-ring/50 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-3 py-1.5 focus-within:ring-[3px]"
            onClick={() => tagInputRef.current?.focus()}
          >
            {tags.map((tag, i) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                {tag}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeTag(i); }}
                  className="rounded-sm text-primary/60 hover:text-primary"
                  data-testid={`word-tag-remove-${i}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
              placeholder={tags.length === 0 ? t.wordbooks.tagsPlaceholder : ''}
              className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              data-testid="word-form-tags"
            />
          </div>
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

      {/* Footer — fixed outside scroll */}
      {renderFooter ? (
        renderFooter({ canSubmit: !!canSubmit, submitting })
      ) : (
        <div className={bottomBar}>
          <div className={bottomSep} />
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || !canSubmit}
            data-testid="word-form-submit"
          >
            {submitting ? t.common.saving : label}
          </Button>
        </div>
      )}
    </form>
  );
}
