'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Header } from '@/components/layout/header';
import { ImageCapture } from '@/components/scan/image-capture';
import { WordPreview } from '@/components/scan/word-preview';
import { WordConfirm } from '@/components/scan/word-confirm';
import { ScanComplete } from '@/components/scan/scan-complete';
import { Button } from '@/components/ui/button';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { useAuthStore } from '@/stores/auth-store';
import { getLocalOcrMode, fetchOcrSettings } from '@/lib/ocr/settings';
import { extractWordsFromImage, type ExtractionResult } from '@/lib/ocr/extract';
import { fetchProfile } from '@/lib/profile/fetch';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import Link from 'next/link';

type Step = 'capture' | 'preview' | 'confirm' | 'done';

export default function ScanPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [step, setStep] = useState<Step>('capture');
  const [extracting, setExtracting] = useState(false);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);

  // OCR flow state
  const [selectedOcrWords, setSelectedOcrWords] = useState<string[]>([]);
  const [currentConfirmIndex, setCurrentConfirmIndex] = useState(0);
  const [addedCount, setAddedCount] = useState(0);

  // LLM flow state
  const [selectedLlmWords, setSelectedLlmWords] = useState<ExtractedWord[]>([]);

  // User JLPT level for filtering
  const [userJlptLevel, setUserJlptLevel] = useState<number | null>(null);

  // Guard: LLM mode needs API key configured on server
  const mode = getLocalOcrMode();
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [guardLoading, setGuardLoading] = useState(mode === 'llm');

  useEffect(() => {
    if (mode !== 'llm' || !user) {
      setGuardLoading(false);
      return;
    }

    fetchOcrSettings()
      .then((settings) => {
        setNeedsApiKey(!settings.hasApiKey);
      })
      .catch(() => {
        setNeedsApiKey(true);
      })
      .finally(() => setGuardLoading(false));
  }, [mode, user]);

  useEffect(() => {
    if (!user) return;
    fetchProfile()
      .then((p) => setUserJlptLevel(p.jlptLevel))
      .catch(() => {});
  }, [user]);

  const handleExtract = useCallback(async (imageDataUrl: string) => {
    const currentMode = getLocalOcrMode();
    setExtracting(true);
    try {
      const result = await extractWordsFromImage(imageDataUrl, currentMode);
      setExtractionResult(result);
      setStep('preview');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Extraction failed';
      toast.error(message);
    } finally {
      setExtracting(false);
    }
  }, []);

  const handleOcrConfirm = (words: string[]) => {
    setSelectedOcrWords(words);
    setCurrentConfirmIndex(0);
    setStep('confirm');
  };

  const handleLlmConfirm = async (words: ExtractedWord[]) => {
    setSelectedLlmWords(words);
    let count = 0;
    for (const word of words) {
      try {
        await repo.words.create({
          term: word.term,
          reading: word.reading,
          meaning: word.meaning,
          jlptLevel: word.jlptLevel,
          priority: 2,
        });
        count++;
      } catch (err) {
        if (err instanceof Error && err.message === 'DUPLICATE_WORD') {
          // Skip duplicates silently
        } else {
          throw err;
        }
      }
    }
    setAddedCount(count);
    setStep('done');
    toast.success(t.scan.wordsAdded(count));
  };

  const handleWordAdd = async (data: {
    term: string;
    reading: string;
    meaning: string;
    jlptLevel: number | null;
  }) => {
    await repo.words.create({
      term: data.term,
      reading: data.reading,
      meaning: data.meaning,
      jlptLevel: data.jlptLevel,
    });
    setAddedCount((c) => c + 1);

    if (currentConfirmIndex + 1 >= selectedOcrWords.length) {
      setStep('done');
    } else {
      setCurrentConfirmIndex((i) => i + 1);
    }
  };

  const handleSkip = () => {
    if (currentConfirmIndex + 1 >= selectedOcrWords.length) {
      setStep('done');
    } else {
      setCurrentConfirmIndex((i) => i + 1);
    }
  };

  const handleReset = () => {
    setStep('capture');
    setExtractionResult(null);
    setSelectedOcrWords([]);
    setSelectedLlmWords([]);
    setCurrentConfirmIndex(0);
    setAddedCount(0);
  };

  return (
    <>
      <Header title={t.scan.title} showBack />

      {guardLoading ? (
        <div className="animate-page p-4 text-center text-sm text-muted-foreground">
          {t.common.loading}
        </div>
      ) : needsApiKey && step === 'capture' ? (
        <div className="animate-page space-y-4 p-4 text-center">
          <div className="py-8 text-sm text-muted-foreground">
            {t.settings.configureRequired}
          </div>
          <Link href="/settings/ocr">
            <Button variant="outline">{t.settings.goToSettings}</Button>
          </Link>
        </div>
      ) : step === 'capture' ? (
        <ImageCapture onExtract={handleExtract} extracting={extracting} />
      ) : step === 'preview' && extractionResult ? (
        extractionResult.mode === 'ocr' ? (
          <WordPreview
            mode="ocr"
            words={extractionResult.words}
            onConfirm={handleOcrConfirm}
            onRetry={handleReset}
          />
        ) : (
          <WordPreview
            mode="llm"
            words={extractionResult.words}
            userJlptLevel={userJlptLevel}
            onConfirm={handleLlmConfirm}
            onRetry={handleReset}
          />
        )
      ) : step === 'confirm' ? (
        <WordConfirm
          words={selectedOcrWords}
          currentIndex={currentConfirmIndex}
          onAdd={handleWordAdd}
          onSkip={handleSkip}
        />
      ) : step === 'done' ? (
        <ScanComplete addedCount={addedCount} onAddMore={handleReset} />
      ) : null}
    </>
  );
}
