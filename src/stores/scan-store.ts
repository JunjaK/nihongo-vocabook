'use client';

import { create } from 'zustand';
import { extractWordsFromImage } from '@/lib/ocr/extract';
import { getLocalOcrMode } from '@/lib/ocr/settings';
import { searchDictionary, searchDictionaryBatch } from '@/lib/dictionary/jisho';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import type { DictionaryEntry } from '@/types/word';

const KANJI_CHAR_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const SINGLE_KANJI_REGEX = /^[\u4E00-\u9FFF\u3400-\u4DBF]$/;
const KATAKANA_ONLY_REGEX = /^[\u30A0-\u30FF]+$/;
const HIRAGANA_ONLY_REGEX = /^[\u3040-\u309F]+$/;

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
  let score = sourceBoost;
  if (word.meaning) score += 8;
  if (word.reading) score += 4;
  if (KANJI_CHAR_REGEX.test(word.term)) score += 3;
  if (word.jlptLevel !== null) score += 2;
  score += Math.min(word.term.length, 8) * 0.2;
  if (existingTerms.has(word.term)) score -= 5;
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

    // Single-kanji or very short kana fragments are usually OCR split artifacts.
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

function isShortKatakana(term: string): boolean {
  return KATAKANA_ONLY_REGEX.test(term) && term.length <= 3;
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

  // Katakana fragments are often OCR noise; keep only with stronger lexical signals.
  if (KATAKANA_ONLY_REGEX.test(term) && term.length <= 4) {
    if (isExisting) return true;
    if (!word.meaning || !word.reading) return false;
    if (term.length <= 3) return false;
    return word.jlptLevel !== null;
  }

  // Single kanji is allowed only conditionally.
  if (SINGLE_KANJI_REGEX.test(term)) {
    if (isExisting) return true;
    return Boolean(word.meaning) && Boolean(word.reading);
  }

  return true;
}

function mergeWords(primary: ExtractedWord, secondary: ExtractedWord): ExtractedWord {
  return {
    term: primary.term,
    reading: primary.reading || secondary.reading,
    meaning:
      primary.meaning.length >= secondary.meaning.length ? primary.meaning : secondary.meaning,
    jlptLevel: primary.jlptLevel ?? secondary.jlptLevel,
  };
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

function buildEnsembledWords(
  ocrWords: ExtractedWord[],
  llmWords: ExtractedWord[],
  existingTerms: Set<string>,
): ExtractedWord[] {
  const ocrMap = new Map(ocrWords.map((word) => [word.term, word]));
  const llmMap = new Map(llmWords.map((word) => [word.term, word]));

  const both: ExtractedWord[] = [];
  const ocrOnly: ExtractedWord[] = [];
  const llmOnly: ExtractedWord[] = [];

  for (const [term, ocrWord] of ocrMap) {
    const llmWord = llmMap.get(term);
    if (llmWord) {
      both.push(mergeWords(ocrWord, llmWord));
    } else {
      ocrOnly.push(ocrWord);
    }
  }

  for (const [term, llmWord] of llmMap) {
    if (!ocrMap.has(term)) llmOnly.push(llmWord);
  }

  return [
    ...rerankWords(both, existingTerms, 8),
    ...rerankWords(ocrOnly, existingTerms, 4),
    ...rerankWords(llmOnly, existingTerms, 2),
  ];
}

function toExtractedWord(raw: string, entries: DictionaryEntry[], locale: string): ExtractedWord {
  if (entries.length === 0) {
    return { term: raw, reading: '', meaning: '', jlptLevel: null };
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
    return { term: raw, reading: '', meaning: '', jlptLevel: null };
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
      const runLlm = currentMode === 'llm' || currentMode === 'hybrid';
      const runOcr = currentMode === 'ocr' || currentMode === 'hybrid';

      for (const imageDataUrl of imageDataUrls) {
        if (get().cancelId !== id) return;

        if (runLlm) {
          const llmResult = await extractWordsFromImage(
            imageDataUrl,
            'llm',
            undefined,
            locale,
            controller.signal,
          );
          if (llmResult.mode === 'llm') {
            allLlmWords.push(...llmResult.words);
          }
        }

        if (runOcr) {
          try {
            const ocrResult = await extractWordsFromImage(
              imageDataUrl,
              'ocr',
              undefined,
              locale,
              controller.signal,
            );
            if (ocrResult.mode === 'ocr') {
              allOcrWords.push(...ocrResult.words);
            }
          } catch {
            if (controller.signal.aborted) return;
          }
        }
      }

      if (get().cancelId !== id) return;

      const uniqueLlmWords = dedupExtractedWords(allLlmWords);
      const ocrFrequency = buildTermFrequencyMap(allOcrWords);
      const uniqueOcrWords = allOcrWords.filter(
        (word, index) => word && allOcrWords.indexOf(word) === index,
      );
      const filteredOcrWords = uniqueOcrWords.filter((word) => shouldKeepOcrTerm(word, ocrFrequency));
      const termsToCheck = [
        ...filteredOcrWords,
        ...uniqueLlmWords.map((word) => word.term),
      ];
      const existingTerms = options?.resolveExistingTerms
        ? await options.resolveExistingTerms(termsToCheck)
        : new Set<string>();

      if (allOcrWords.length > 0) {
        const lookupTargets = filteredOcrWords.filter((word) => !existingTerms.has(word));
        const resultMap = new Map<string, ExtractedWord>();
        for (const term of existingTerms) {
          resultMap.set(term, { term, reading: '', meaning: '', jlptLevel: null });
        }

        // Enrich OCR words with dictionary lookups
        if (lookupTargets.length > 0) {
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
            set({
              enrichProgress: { current: batchFoundCount + i + 1, total: lookupTargets.length },
            });
          }
        }

        if (get().cancelId !== id) return;

        const ocrResults = filteredOcrWords.map(
          (raw) => resultMap.get(raw) ?? { term: raw, reading: '', meaning: '', jlptLevel: null },
        );

        const finalResults = uniqueLlmWords.length > 0
          ? buildEnsembledWords(ocrResults, uniqueLlmWords, existingTerms)
          : rerankWords(ocrResults, existingTerms, 4);

        set({ status: 'preview', enrichedWords: finalResults });
      } else {
        set({ status: 'preview', enrichedWords: rerankWords(uniqueLlmWords, existingTerms, 2) });
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
