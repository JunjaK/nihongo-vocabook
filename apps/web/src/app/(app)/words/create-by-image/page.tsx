'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/header';
import { WordForm } from '@/components/word/word-form';
import { ScanComplete } from '@/components/scan/scan-complete';
import { Button } from '@/components/ui/button';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';
import { bottomBar, bottomSep } from '@/lib/styles';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import type { CreateWordInput } from '@/types/word';

export default function CreateByImagePage() {
  const router = useRouter();
  const repo = useRepository();
  const { t } = useTranslation();

  const [words, setWords] = useState<ExtractedWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editedWords, setEditedWords] = useState<Map<number, CreateWordInput>>(new Map());
  const [skippedIndices, setSkippedIndices] = useState<Set<number>>(new Set());
  const [phase, setPhase] = useState<'editing' | 'complete'>('editing');
  const [savedCount, setSavedCount] = useState(0);
  const formKey = useRef(0);

  useEffect(() => {
    const raw = sessionStorage.getItem('scan-edit-words');
    if (!raw) {
      router.replace('/words/scan');
      return;
    }
    setWords(JSON.parse(raw));
  }, [router]);

  const isLast = currentIndex >= words.length - 1;
  const currentWord = words[currentIndex];

  const batchSave = useCallback(async (
    edited: Map<number, CreateWordInput>,
    skipped: Set<number>,
  ) => {
    const wordsToSave = Array.from(edited.entries())
      .filter(([index]) => !skipped.has(index))
      .map(([, data]) => data);

    let saved = 0;
    for (const data of wordsToSave) {
      try {
        await repo.words.create(data);
        saved++;
      } catch (err) {
        if (err instanceof Error && err.message === 'DUPLICATE_WORD') {
          // Skip duplicates silently during batch save
        } else {
          throw err;
        }
      }
    }

    sessionStorage.removeItem('scan-edit-words');
    invalidateListCache('words');
    setSavedCount(saved);
    setPhase('complete');
  }, [repo]);

  const handleSubmit = useCallback(async (data: CreateWordInput) => {
    const nextEdited = new Map(editedWords);
    nextEdited.set(currentIndex, data);
    setEditedWords(nextEdited);

    // Un-skip if user submits via Next
    const nextSkipped = new Set(skippedIndices);
    nextSkipped.delete(currentIndex);
    setSkippedIndices(nextSkipped);

    if (isLast) {
      await batchSave(nextEdited, nextSkipped);
    } else {
      setCurrentIndex((i) => i + 1);
      formKey.current += 1;
    }
  }, [editedWords, currentIndex, skippedIndices, isLast, batchSave]);

  const handleSkip = useCallback(async () => {
    const nextEdited = new Map(editedWords);
    nextEdited.delete(currentIndex);
    setEditedWords(nextEdited);

    const nextSkipped = new Set(skippedIndices);
    nextSkipped.add(currentIndex);
    setSkippedIndices(nextSkipped);

    if (isLast) {
      await batchSave(nextEdited, nextSkipped);
    } else {
      setCurrentIndex((i) => i + 1);
      formKey.current += 1;
    }
  }, [currentIndex, isLast, editedWords, skippedIndices, batchSave]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      formKey.current += 1;
    }
  }, [currentIndex]);

  const handleAddMore = () => {
    router.push('/words/scan');
  };

  if (phase === 'complete') {
    return (
      <>
        <Header title={t.scan.title} showBack />
        <ScanComplete addedCount={savedCount} onAddMore={handleAddMore} />
      </>
    );
  }

  if (!currentWord) return null;

  const editedData = editedWords.get(currentIndex);
  const initialValues = editedData
    ? {
        term: editedData.term,
        reading: editedData.reading,
        meaning: editedData.meaning,
        notes: editedData.notes,
        tags: editedData.tags,
        jlptLevel: editedData.jlptLevel,
      }
    : {
        term: currentWord.term,
        reading: currentWord.reading,
        meaning: currentWord.meaning,
        jlptLevel: currentWord.jlptLevel,
      };

  const skippedCount = skippedIndices.size;

  return (
    <>
      <Header
        title={t.scan.title}
        showBack
        actions={
          <span className="text-sm text-muted-foreground">
            {t.scan.editWordProgress(currentIndex + 1, words.length)}
            {skippedCount > 0 && (
              <span className="ml-1.5 text-xs">({t.scan.skippedCount(skippedCount)})</span>
            )}
          </span>
        }
      />
      <WordForm
        key={formKey.current}
        initialValues={initialValues}
        onSubmit={handleSubmit}
        showDictionarySearch={false}
        renderFooter={({ canSubmit, submitting }) => (
          <div className={bottomBar}>
            <div className={bottomSep} />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={currentIndex === 0}
                onClick={handlePrevious}
                data-testid="create-by-image-prev"
              >
                {t.common.previous}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleSkip}
                data-testid="create-by-image-skip"
              >
                {t.scan.skip}
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={!canSubmit || submitting}
                data-testid="create-by-image-next"
              >
                {submitting
                  ? t.common.saving
                  : isLast
                    ? t.common.complete
                    : t.common.next}
              </Button>
            </div>
          </div>
        )}
      />
    </>
  );
}
