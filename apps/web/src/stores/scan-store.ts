'use client';

import { create } from 'zustand';
import { extractWithTesseract } from '@/lib/ocr/tesseract';
import { extractWithGemma } from '@/lib/ai/gemma-web';
import { isGemmaReady } from '@/lib/ai/gemma-web';
import { searchDictionary, searchDictionaryBatch } from '@/lib/dictionary/jisho';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import type { DictionaryEntry } from '@/types/word';

const KANJI_CHAR_REGEX = /[一-鿿㐀-䶿]/;
const SINGLE_KANJI_REGEX = /^[一-鿿㐀-䶿]$/;
const KATAKANA_ONLY_REGEX = /^[゠-ヿ]+$/;
const HIRAGANA_ONLY_REGEX = /^[぀-ゟ]+$/;

function buildNormalizedLookupForms(raw: string): string[] {
  const normalized = raw.normalize('NFKC');
  const forms = new Set<string>([normalized]);

  const stripEndings = ['ながら', 'つつ', 'など', 'です', 'でした', 'ます', 'ました', 'して'];
  for (const ending of stripEndings) {
    if (!normalized.endsWith(ending)) continue;
    const stem = normalized.slice(0, -ending.length);
    if (stem.length < 2) continue;
    forms.add(stem);
    forms.add(`${stem}る`);
  }

  return [...forms];
}

function isOverContractedMapping(raw: string, term: string): boolean {
  const rawHasKanji = KANJI_CHAR_REGEX.test(raw);
  if (!rawHasKanji) return false;

  if (raw.length >= 3 && term.length <= 1) return true;
  if (raw.length >= 4 && term.length <= 2) return true;
  if (raw.length - term.length >= 3) return true;

  return false;
}

export type ScanStatus = 'idle' | 'extracting' | 'enriching' | 'preview' | 'done';

interface ScanState {
  status: ScanStatus;
  capturedImages: string[];
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

function scoreDictionaryCandidate(raw: string, term: string, reading: string, entryIndex: number): number {
  const rawNormalized = raw.normalize('NFKC');
  const termNormalized = term.normalize('NFKC');
  const readingNormalized = reading.normalize('NFKC');
  const exactTerm = termNormalized === rawNormalized;
  const exactReading = readingNormalized === rawNormalized;
  const lookupForms = buildNormalizedLookupForms(raw);

  let score = 0;
  if (exactTerm) score += 140;
  else if (exactReading) score += 120;
  else if (termNormalized.includes(rawNormalized) || rawNormalized.includes(termNormalized)) score += 35;
  else if (readingNormalized.includes(rawNormalized) || rawNormalized.includes(readingNormalized)) score += 20;

  for (const form of lookupForms) {
    if (form === rawNormalized) continue;
    if (termNormalized === form) score += 30;
    if (termNormalized === `${form}る`) score += 35;
    if (termNormalized.includes(form)) score += 10;
  }

  if (KANJI_CHAR_REGEX.test(term)) score += 6;
  if (term.length >= 2) score += 3;
  if (term.length >= 3) score += 4;
  if (KANJI_CHAR_REGEX.test(rawNormalized) && KANJI_CHAR_REGEX.test(termNormalized) && termNormalized.length >= 2) {
    score += 8;
  }
  if (isOverContractedMapping(rawNormalized, termNormalized)) {
    score -= 30;
  }
  if (SINGLE_KANJI_REGEX.test(termNormalized)) {
    score -= 10;
  }
  score -= Math.min(entryIndex, 10);
  return score;
}

function shouldAllowDictionarySubstitution(raw: string, term: string, reading: string): boolean {
  const rawNormalized = raw.normalize('NFKC');
  const termNormalized = term.normalize('NFKC');
  const readingNormalized = reading.normalize('NFKC');
  const lookupForms = buildNormalizedLookupForms(raw);

  if (termNormalized === rawNormalized || readingNormalized === rawNormalized) return true;
  if (lookupForms.some((form) => termNormalized === form || termNormalized === `${form}る`)) return true;

  if (isOverContractedMapping(rawNormalized, termNormalized)) return false;

  const rawHasKanji = KANJI_CHAR_REGEX.test(rawNormalized);
  if (!rawHasKanji && rawNormalized.length <= 2) return false;
  if (KATAKANA_ONLY_REGEX.test(rawNormalized) && rawNormalized.length <= 4) return false;
  if (HIRAGANA_ONLY_REGEX.test(rawNormalized) && rawNormalized.length <= 3) return false;

  if (!rawHasKanji && termNormalized.length - rawNormalized.length >= 3) return false;

  return termNormalized.includes(rawNormalized) || readingNormalized.includes(rawNormalized);
}

function scorePartsOfSpeechPenalty(entry: DictionaryEntry): number {
  const parts = entry.senses.flatMap((sense) => sense.partsOfSpeech);
  const hasPrefixLike = parts.some((pos) => pos === 'pref' || pos === 'suf');
  return hasPrefixLike ? 20 : 0;
}

function scorePreviewWord(word: ExtractedWord, existingTerms: Set<string>, sourceBoost = 0): number {
  if (existingTerms.has(word.term)) return -1000;
  let score = sourceBoost;
  if (word.meaning) score += 8;
  if (word.reading) score += 4;
  if (KANJI_CHAR_REGEX.test(word.term)) score += 3;
  if (word.jlptLevel !== null) score += 2;
  score += Math.min(word.term.length, 8) * 0.2;
  return score;
}

function dedupExtractedWords(words: ExtractedWord[]): ExtractedWord[] {
  const seen = new Set<string>();
  return words.filter((word) => {
    if (!word.term || seen.has(word.term)) return false;
    seen.add(word.term);
    return true;
  });
}

function shouldSuppressAsFragment(
  term: string,
  termSet: Set<string>,
  existingTerms: Set<string>,
): boolean {
  if (existingTerms.has(term)) return false;

  for (const candidate of termSet) {
    if (candidate === term) continue;
    if (candidate.length <= term.length) continue;
    if (!candidate.includes(term)) continue;

    if (term.length === 1) return true;
    if ((KATAKANA_ONLY_REGEX.test(term) || HIRAGANA_ONLY_REGEX.test(term)) && term.length <= 3) {
      return true;
    }
  }

  return false;
}

function buildTermFrequencyMap(terms: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const term of terms) {
    if (!term) continue;
    freq.set(term, (freq.get(term) ?? 0) + 1);
  }
  return freq;
}

function shouldKeepOcrTerm(term: string, ocrFrequency: Map<string, number>): boolean {
  if (!KATAKANA_ONLY_REGEX.test(term)) return true;

  const frequency = ocrFrequency.get(term) ?? 0;
  if (term.length <= 2) return frequency >= 4;
  if (term.length === 3) return frequency >= 3;
  if (term.length === 4) return frequency >= 2;
  return true;
}

function passesPreviewHeuristic(word: ExtractedWord, existingTerms: Set<string>): boolean {
  const term = word.term;
  const isExisting = existingTerms.has(term);

  if (KATAKANA_ONLY_REGEX.test(term) && term.length <= 4) {
    if (isExisting) return true;
    if (!word.meaning || !word.reading) return false;
    if (term.length <= 3) return false;
    return word.jlptLevel !== null;
  }

  if (SINGLE_KANJI_REGEX.test(term)) {
    if (isExisting) return true;
    return Boolean(word.meaning) && Boolean(word.reading);
  }

  return true;
}

function rerankWords(words: ExtractedWord[], existingTerms: Set<string>, sourceBoost = 0): ExtractedWord[] {
  const deduped = [...dedupExtractedWords(words)];
  const termSet = new Set(deduped.map((word) => word.term));

  return deduped
    .filter((word) => !shouldSuppressAsFragment(word.term, termSet, existingTerms))
    .filter((word) => passesPreviewHeuristic(word, existingTerms))
    .sort(
      (a, b) =>
        scorePreviewWord(b, existingTerms, sourceBoost) -
        scorePreviewWord(a, existingTerms, sourceBoost),
    );
}

function toExtractedWord(
  raw: string,
  entries: DictionaryEntry[],
  locale: string,
  hint?: ExtractedWord,
): ExtractedWord {
  if (entries.length === 0) {
    if (hint) {
      return { ...hint, term: raw, dictionaryEntryId: null };
    }
    return { term: raw, reading: '', meaning: '', jlptLevel: null, dictionaryEntryId: null };
  }

  let best:
    | {
      entry: DictionaryEntry;
      word: string;
      reading: string;
      score: number;
    }
    | undefined;

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex];
    for (const jp of entry.japanese) {
      const term = jp.word ?? jp.reading ?? raw;
      const reading = jp.reading ?? '';
      if (!shouldAllowDictionarySubstitution(raw, term, reading)) continue;

      const posPenalty = scorePartsOfSpeechPenalty(entry);
      const score = scoreDictionaryCandidate(raw, term, reading, entryIndex) - posPenalty;
      if (!best || score > best.score) {
        best = { entry, word: term, reading, score };
      }
    }
  }

  if (!best) {
    if (hint) {
      return { ...hint, term: raw, dictionaryEntryId: null };
    }
    return { term: raw, reading: '', meaning: '', jlptLevel: null, dictionaryEntryId: null };
  }

  const entry = best.entry;
  const term = best.word;
  const reading = best.reading;
  const jlptMatch = entry.jlptLevels[0]?.match(/\d/);

  return {
    term,
    reading,
    meaning: getMeaning(entries, locale),
    jlptLevel: jlptMatch ? Number(jlptMatch[0]) : null,
    dictionaryEntryId: entry.id || null,
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export const useScanStore = create<ScanState>((set, get) => ({
  status: 'idle',
  capturedImages: [],
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
      capturedImages: imageDataUrls,
      enrichedWords: [],
      enrichProgress: { current: 0, total: 0 },
      addedCount: 0,
      cancelId: id,
      activeController: controller,
    });

    try {
      const useGemma = isGemmaReady();
      const collectedTerms: string[] = [];
      const hints = new Map<string, ExtractedWord>();

      for (const imageDataUrl of imageDataUrls) {
        if (get().cancelId !== id) return;

        if (useGemma) {
          const words = await extractWithGemma(imageDataUrl, locale, controller.signal);
          for (const w of words) {
            collectedTerms.push(w.term);
            if (!hints.has(w.term)) hints.set(w.term, w);
          }
        } else {
          try {
            const words = await extractWithTesseract(imageDataUrl, undefined, controller.signal);
            collectedTerms.push(...words);
          } catch {
            if (controller.signal.aborted) return;
          }
        }
      }

      if (get().cancelId !== id) return;

      const ocrFrequency = buildTermFrequencyMap(collectedTerms);
      const uniqueTerms = [...new Set(collectedTerms)];
      const filteredTerms = useGemma
        ? uniqueTerms
        : uniqueTerms.filter((word) => shouldKeepOcrTerm(word, ocrFrequency));
      const existingTerms = options?.resolveExistingTerms
        ? await options.resolveExistingTerms(filteredTerms)
        : new Set<string>();

      if (filteredTerms.length === 0) {
        set({ status: 'preview', enrichedWords: [] });
        return;
      }

      const lookupTargets = filteredTerms.filter((word) => !existingTerms.has(word));
      const resultMap = new Map<string, ExtractedWord>();
      for (const term of existingTerms) {
        resultMap.set(term, hints.get(term) ?? { term, reading: '', meaning: '', jlptLevel: null });
      }

      if (lookupTargets.length > 0) {
        set({ status: 'enriching', enrichProgress: { current: 0, total: lookupTargets.length } });

        const batchResult = await searchDictionaryBatch(lookupTargets, locale, {
          signal: controller.signal,
        });
        if (get().cancelId !== id) return;

        for (const [term, entries] of batchResult.found) {
          resultMap.set(term, toExtractedWord(term, entries, locale, hints.get(term)));
        }

        const batchFoundCount = batchResult.found.size;
        set({ enrichProgress: { current: batchFoundCount, total: lookupTargets.length } });

        for (let i = 0; i < batchResult.missing.length; i++) {
          if (get().cancelId !== id) return;

          const raw = batchResult.missing[i];
          if (i > 0) await new Promise((r) => setTimeout(r, 200));

          try {
            const entries = await searchDictionary(raw, locale, {
              signal: controller.signal,
            });
            resultMap.set(raw, toExtractedWord(raw, entries, locale, hints.get(raw)));
          } catch {
            if (controller.signal.aborted) return;
            resultMap.set(raw, hints.get(raw) ?? { term: raw, reading: '', meaning: '', jlptLevel: null });
          }
          set({
            enrichProgress: { current: batchFoundCount + i + 1, total: lookupTargets.length },
          });
        }
      }

      if (get().cancelId !== id) return;

      const results = filteredTerms.map(
        (raw) => resultMap.get(raw) ?? hints.get(raw) ?? { term: raw, reading: '', meaning: '', jlptLevel: null },
      );

      set({
        status: 'preview',
        enrichedWords: rerankWords(results, existingTerms, useGemma ? 6 : 4),
      });
    } catch (err) {
      if (get().cancelId !== id || isAbortError(err)) return;

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
      capturedImages: [],
      enrichedWords: [],
      enrichProgress: { current: 0, total: 0 },
      addedCount: 0,
      cancelId: get().cancelId + 1,
      activeController: null,
    });
  },
}));
