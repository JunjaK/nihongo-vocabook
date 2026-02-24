'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { WordForm } from '@/components/word/word-form';
import { Button } from '@/components/ui/button';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';
import { bottomBar, bottomSep } from '@/lib/styles';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import type { Word } from '@/types/word';

export default function CreateByImagePage() {
  const router = useRouter();
  const repo = useRepository();
  const { t } = useTranslation();

  const [words, setWords] = useState<ExtractedWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [addedCount, setAddedCount] = useState(0);
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

  const handleSubmit = useCallback(async (data: Parameters<typeof repo.words.create>[0]) => {
    try {
      await repo.words.create(data);
      setAddedCount((c) => c + 1);
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_WORD') {
        toast.error(t.words.duplicateWord);
      } else {
        throw err;
      }
    }

    if (isLast) {
      sessionStorage.removeItem('scan-edit-words');
      invalidateListCache('words');
      toast.success(t.scan.wordsAdded(addedCount + 1));
      router.push('/words');
    } else {
      setCurrentIndex((i) => i + 1);
      formKey.current += 1;
    }
  }, [repo, isLast, addedCount, router, t]);

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      formKey.current += 1;
    }
  };

  if (!currentWord) return null;

  const initialValues: Partial<Word> = {
    term: currentWord.term,
    reading: currentWord.reading,
    meaning: currentWord.meaning,
    jlptLevel: currentWord.jlptLevel,
  };

  return (
    <>
      <Header
        title={t.scan.title}
        showBack
        actions={
          <span className="text-sm text-muted-foreground">
            {t.scan.editWordProgress(currentIndex + 1, words.length)}
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
