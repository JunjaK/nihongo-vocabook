'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Camera } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { ImageCapture, type ImageCaptureHandle } from '@/components/scan/image-capture';
import { WordPreview } from '@/components/scan/word-preview';
import { ScanComplete } from '@/components/scan/scan-complete';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useRepository } from '@/lib/repository/provider';
import { useTranslation } from '@/lib/i18n';
import { invalidateListCache } from '@/lib/list-cache';
import { useAuthStore } from '@/stores/auth-store';
import { getLocalOcrMode, fetchOcrSettings } from '@/lib/ocr/settings';
import { extractWordsFromImage } from '@/lib/ocr/extract';
import { fetchProfile } from '@/lib/profile/fetch';
import { searchDictionary, searchDictionaryBatch } from '@/lib/dictionary/jisho';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import Link from 'next/link';

type Step = 'capture' | 'preview' | 'done';

export default function ScanPage() {
  const repo = useRepository();
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [step, setStep] = useState<Step>('capture');
  const [extracting, setExtracting] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const imageCaptureRef = useRef<ImageCaptureHandle>(null);

  // Enriched words for preview (used by both OCR and LLM modes)
  const [enrichedWords, setEnrichedWords] = useState<ExtractedWord[]>([]);

  // OCR enrichment state
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ current: 0, total: 0 });
  const enrichCancelledRef = useRef(false);

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

  const toExtractedWord = (raw: string, entries: { japanese: { word?: string; reading: string }[]; senses: { englishDefinitions: string[]; partsOfSpeech: string[] }[]; jlptLevels: string[] }[]): ExtractedWord => {
    if (entries.length === 0) {
      return { term: raw, reading: '', meaning: '', jlptLevel: null };
    }
    const entry = entries[0];
    const jp = entry.japanese[0];
    const sense = entry.senses[0];
    const jlptMatch = entry.jlptLevels[0]?.match(/\d/);
    return {
      term: jp?.word ?? jp?.reading ?? raw,
      reading: jp?.reading ?? '',
      meaning: sense?.englishDefinitions.slice(0, 3).join(', ') ?? '',
      jlptLevel: jlptMatch ? Number(jlptMatch[0]) : null,
    };
  };

  const enrichOcrWords = useCallback(async (rawWords: string[]) => {
    setEnriching(true);
    setEnrichProgress({ current: 0, total: rawWords.length });
    enrichCancelledRef.current = false;

    // 1. Batch lookup from DB
    const batchResult = await searchDictionaryBatch(rawWords);
    if (enrichCancelledRef.current) return;

    // Build a map of raw word → ExtractedWord for found entries
    const resultMap = new Map<string, ExtractedWord>();
    for (const [term, entries] of batchResult.found) {
      resultMap.set(term, toExtractedWord(term, entries));
    }

    const batchFoundCount = batchResult.found.size;
    setEnrichProgress({ current: batchFoundCount, total: rawWords.length });

    // 2. Sequential Jisho lookups for misses only
    for (let i = 0; i < batchResult.missing.length; i++) {
      if (enrichCancelledRef.current) return;

      const raw = batchResult.missing[i];
      if (i > 0) await new Promise((r) => setTimeout(r, 200));

      try {
        const entries = await searchDictionary(raw);
        resultMap.set(raw, toExtractedWord(raw, entries));
      } catch {
        resultMap.set(raw, { term: raw, reading: '', meaning: '', jlptLevel: null });
      }
      setEnrichProgress({ current: batchFoundCount + i + 1, total: rawWords.length });
    }

    if (!enrichCancelledRef.current) {
      // Preserve original order
      const results = rawWords.map((raw) => resultMap.get(raw) ?? { term: raw, reading: '', meaning: '', jlptLevel: null });
      setEnrichedWords(results);
      setEnriching(false);
      setStep('preview');
    }
  }, []);

  const handleExtract = useCallback(async (imageDataUrls: string[]) => {
    const currentMode = getLocalOcrMode();
    setExtracting(true);
    try {
      const allOcrWords: string[] = [];
      const allLlmWords: ExtractedWord[] = [];

      for (const imageDataUrl of imageDataUrls) {
        const result = await extractWordsFromImage(imageDataUrl, currentMode);
        if (result.mode === 'ocr') {
          allOcrWords.push(...result.words);
        } else {
          allLlmWords.push(...result.words);
        }
      }

      if (allOcrWords.length > 0) {
        setExtracting(false);
        await enrichOcrWords(allOcrWords);
      } else {
        // Deduplicate LLM words by term
        const seen = new Set<string>();
        const unique = allLlmWords.filter((w) => {
          if (seen.has(w.term)) return false;
          seen.add(w.term);
          return true;
        });
        setEnrichedWords(unique);
        setExtracting(false);
        setStep('preview');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Extraction failed';
      toast.error(message);
      setExtracting(false);
    }
  }, [enrichOcrWords]);

  const handleBulkAdd = async (words: ExtractedWord[]) => {
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
    if (count > 0) invalidateListCache('words');
    setStep('done');
    toast.success(t.scan.wordsAdded(count));
  };

  const handleReset = () => {
    enrichCancelledRef.current = true;
    setStep('capture');
    setEnrichedWords([]);
    setEnriching(false);
    setEnrichProgress({ current: 0, total: 0 });
    setAddedCount(0);
  };

  return (
    <>
      <Header
        title={t.scan.title}
        showBack
        actions={
          step === 'capture' && !guardLoading && !needsApiKey && !enriching ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t.scan.takePhoto}
              onClick={() => imageCaptureRef.current?.openCamera()}
              disabled={extracting}
            >
              <Camera className="size-5" />
            </Button>
          ) : undefined
        }
      />

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
      ) : enriching ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <LoadingSpinner className="size-8" />
          <div className="text-sm">
            {t.scan.enrichingWords}
          </div>
          <div className="text-lg font-medium text-foreground">
            {enrichProgress.current} / {enrichProgress.total}
          </div>
        </div>
      ) : step === 'capture' ? (
        <ImageCapture ref={imageCaptureRef} onExtract={handleExtract} extracting={extracting} />
      ) : step === 'preview' ? (
        <WordPreview
          words={enrichedWords}
          userJlptLevel={userJlptLevel}
          onConfirm={handleBulkAdd}
          onRetry={handleReset}
        />
      ) : step === 'done' ? (
        <ScanComplete addedCount={addedCount} onAddMore={handleReset} />
      ) : null}
    </>
  );
}
