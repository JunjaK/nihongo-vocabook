'use client';

import { create } from 'zustand';
import { extractWordsFromImage } from '@/lib/ocr/extract';
import { getLocalOcrMode } from '@/lib/ocr/settings';
import { searchDictionary, searchDictionaryBatch } from '@/lib/dictionary/jisho';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import type { DictionaryEntry } from '@/types/word';

export type ScanStatus = 'idle' | 'extracting' | 'enriching' | 'preview' | 'done';

interface ScanState {
  status: ScanStatus;
  enrichedWords: ExtractedWord[];
  enrichProgress: { current: number; total: number };
  addedCount: number;
  cancelId: number;
  activeController: AbortController | null;
  startExtraction: (
    imageDataUrls: string[],
    locale: string,
    options?: {
      resolveExistingTerms?: (terms: string[]) => Promise<Set<string>>;
    },
  ) => Promise<void>;
  setDone: (count: number) => void;
  reset: () => void;
}

function getMeaning(entries: DictionaryEntry[], locale: string): string {
  if (entries.length === 0) return '';
  const sense = entries[0].senses[0];
  if (locale === 'ko' && sense?.koreanDefinitions && sense.koreanDefinitions.length > 0) {
    return sense.koreanDefinitions.slice(0, 3).join(', ');
  }
  return sense?.englishDefinitions.slice(0, 3).join(', ') ?? '';
}

function toExtractedWord(raw: string, entries: DictionaryEntry[], locale: string): ExtractedWord {
  if (entries.length === 0) {
    return { term: raw, reading: '', meaning: '', jlptLevel: null };
  }
  const entry = entries[0];
  const jp = entry.japanese[0];
  const jlptMatch = entry.jlptLevels[0]?.match(/\d/);
  return {
    term: jp?.word ?? jp?.reading ?? raw,
    reading: jp?.reading ?? '',
    meaning: getMeaning(entries, locale),
    jlptLevel: jlptMatch ? Number(jlptMatch[0]) : null,
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export const useScanStore = create<ScanState>((set, get) => ({
  status: 'idle',
  enrichedWords: [],
  enrichProgress: { current: 0, total: 0 },
  addedCount: 0,
  cancelId: 0,
  activeController: null,

  startExtraction: async (imageDataUrls, locale, options) => {
    get().activeController?.abort();
    const controller = new AbortController();
    const id = get().cancelId + 1;
    set({
      status: 'extracting',
      enrichedWords: [],
      enrichProgress: { current: 0, total: 0 },
      addedCount: 0,
      cancelId: id,
      activeController: controller,
    });

    try {
      const currentMode = getLocalOcrMode();
      const allOcrWords: string[] = [];
      const allLlmWords: ExtractedWord[] = [];

      for (const imageDataUrl of imageDataUrls) {
        if (get().cancelId !== id) return;
        const result = await extractWordsFromImage(
          imageDataUrl,
          currentMode,
          undefined,
          locale,
          controller.signal,
        );
        if (result.mode === 'ocr') {
          allOcrWords.push(...result.words);
        } else {
          allLlmWords.push(...result.words);
        }
      }

      if (get().cancelId !== id) return;

      if (allOcrWords.length > 0) {
        // Preserve OCR order while deduplicating, so repeated detections do not trigger repeated lookups.
        const uniqueOcrWords = allOcrWords.filter(
          (word, index) => word && allOcrWords.indexOf(word) === index,
        );
        const existingTerms = options?.resolveExistingTerms
          ? await options.resolveExistingTerms(uniqueOcrWords)
          : new Set<string>();
        const lookupTargets = uniqueOcrWords.filter((word) => !existingTerms.has(word));
        const resultMap = new Map<string, ExtractedWord>();
        for (const term of existingTerms) {
          resultMap.set(term, { term, reading: '', meaning: '', jlptLevel: null });
        }

        if (lookupTargets.length === 0) {
          const results = uniqueOcrWords.map(
            (raw) => resultMap.get(raw) ?? { term: raw, reading: '', meaning: '', jlptLevel: null },
          );
          set({ status: 'preview', enrichedWords: results });
          return;
        }

        // Enrich OCR words with dictionary lookups
        set({ status: 'enriching', enrichProgress: { current: 0, total: lookupTargets.length } });

        // 1. Batch lookup from DB
        const batchResult = await searchDictionaryBatch(lookupTargets, locale, {
          signal: controller.signal,
        });
        if (get().cancelId !== id) return;

        for (const [term, entries] of batchResult.found) {
          resultMap.set(term, toExtractedWord(term, entries, locale));
        }

        const batchFoundCount = batchResult.found.size;
        set({ enrichProgress: { current: batchFoundCount, total: lookupTargets.length } });

        // 2. Sequential Jisho lookups for misses
        for (let i = 0; i < batchResult.missing.length; i++) {
          if (get().cancelId !== id) return;

          const raw = batchResult.missing[i];
          if (i > 0) await new Promise((r) => setTimeout(r, 200));

          try {
            const entries = await searchDictionary(raw, locale, {
              signal: controller.signal,
            });
            resultMap.set(raw, toExtractedWord(raw, entries, locale));
          } catch {
            if (controller.signal.aborted) return;
            resultMap.set(raw, { term: raw, reading: '', meaning: '', jlptLevel: null });
          }
          set({ enrichProgress: { current: batchFoundCount + i + 1, total: lookupTargets.length } });
        }

        if (get().cancelId !== id) return;

        const results = uniqueOcrWords.map(
          (raw) => resultMap.get(raw) ?? { term: raw, reading: '', meaning: '', jlptLevel: null },
        );
        set({ status: 'preview', enrichedWords: results });
      } else {
        // Deduplicate LLM words by term
        const seen = new Set<string>();
        const unique = allLlmWords.filter((w) => {
          if (seen.has(w.term)) return false;
          seen.add(w.term);
          return true;
        });
        set({ status: 'preview', enrichedWords: unique });
      }
    } catch (err) {
      if (get().cancelId !== id || isAbortError(err)) return;

      // Only reset to idle if this extraction wasn't cancelled
      if (get().cancelId === id) {
        set({ status: 'idle', activeController: null });
      }
      throw err;
    } finally {
      if (get().cancelId === id) {
        set({ activeController: null });
      }
    }
  },

  setDone: (count) => set({ status: 'done', addedCount: count, activeController: null }),

  reset: () => {
    get().activeController?.abort();
    return set({
      status: 'idle',
      enrichedWords: [],
      enrichProgress: { current: 0, total: 0 },
      addedCount: 0,
      cancelId: get().cancelId + 1,
      activeController: null,
    });
  },
}));
