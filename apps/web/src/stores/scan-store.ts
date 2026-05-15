'use client';

import { create } from 'zustand';
import { extractViaBridge } from '@/lib/ai/native-bridge-adapter';
import { getSnapshot } from '@/lib/ai/model-manager';
import { isNativeApp } from '@/lib/native-bridge';
import { searchDictionary, searchDictionaryBatch } from '@/lib/dictionary/jisho';
import { lookupTeFormBase } from '@/lib/ocr/te-form-map';
import type { ExtractedWord } from '@/lib/ocr/llm-vision';
import type { DictionaryEntry } from '@/types/word';

const KANJI_CHAR_REGEX = /[一-鿿㐀-䶿]/;
const SINGLE_KANJI_REGEX = /^[一-鿿㐀-䶿]$/;
const KATAKANA_ONLY_REGEX = /^[゠-ヿ]+$/;
const HIRAGANA_ONLY_REGEX = /^[぀-ゟ]+$/;
const KANJI_GLOBAL_REGEX = /[一-鿿㐀-䶿]/g;

/**
 * Inflection endings stripped from a raw term to recover dictionary-form
 * candidates. Ordered longest-first per group so a specific ending (e.g.
 * "ませんでした") strips before a generic one ("した") matches.
 *
 * Grouped by morphological category. The strip applier walks this flat list
 * and stops at the first match; group boundaries are for human readability
 * only. See `_docs/scan-dictionary-fuzzy-match.md` for the full table and
 * design rationale.
 */
const INFLECTION_ENDINGS: readonly string[] = [
  // Group 1 — polite & copula
  'ませんでした',
  'ましょう', 'ましても', 'ませんで', 'でしょう',
  'でした', 'ました', 'ません', 'である', 'だった', 'だろう', 'でしょ',
  'です', 'ます',
  // Group 2 — negative
  'くなかった', 'くなくて', 'なかった',
  'なくては', 'なければ', 'なくて',
  'なきゃ', 'ない',
  // Group 3 — desiderative / propensity / aux
  'たかった', 'たくない', 'たくて',
  'やすい', 'にくい', 'がたい', 'すぎる', 'すぎた',
  'たがる', 'がち', 'がる',
  'たい', 'たく', 'そう',
  // Group 4 — passive / causative / potential
  'させられる', 'させられた',
  'られない', 'られます', 'られた',
  'させない', 'させます', 'させた',
  'られる', 'させる',
  'れる', 'せる', 'れた', 'せた',
  // Group 5 — i-adjective (entries that overlap with negatives like
  // 'くなかった' are deduped at runtime via Set semantics)
  'ければ', 'かった', 'くない', 'くて', 'くなる', 'くする',
  // Group 6 — te / ta form (highest false-positive risk; 1-char endings
  // gated separately via MIN_STEM_FOR_SHORT_ENDING)
  'てしまう', 'ちゃう', 'じゃう',
  'ています', 'ていた', 'ている',
  'ながら', 'つつ',
  'って', 'んで', 'いて', 'した', 'して',
  'たら', 'たり', 'ても', 'なら',
  'た', 'て',
  // Group 7 — imperative / volitional / formal
  'なさい', 'ください', 'おる', 'よう', 'ろ',
] as const;

/**
 * Endings shorter than this length require a longer stem to apply, since the
 * shorter the ending the higher the chance of accidentally chopping a real
 * noun (e.g. 反応 ends in 応, not in the inflection 'う'). 2+ char endings
 * use MIN_STEM_LENGTH instead.
 */
const MIN_STEM_LENGTH = 2;
const MIN_STEM_FOR_SHORT_ENDING = 3;

/**
 * Godan verb i-row → u-row mapping. After stripping a masu-stem ending the
 * stem ends in an i-row kana; rotating that last char to its u-row sibling
 * reconstructs the dictionary form (e.g. 飲み → 飲む, 書き → 書く).
 */
const I_ROW_TO_U_ROW: Readonly<Record<string, string>> = {
  き: 'く', ぎ: 'ぐ',
  し: 'す', じ: 'ず',
  ち: 'つ',
  に: 'ぬ',
  ひ: 'ふ', び: 'ぶ', ぴ: 'ぷ',
  み: 'む',
  り: 'る',
  い: 'う',
};

function containsKanji(s: string): boolean {
  return KANJI_CHAR_REGEX.test(s);
}

function extractKanjiSet(s: string): Set<string> {
  return new Set(s.match(KANJI_GLOBAL_REGEX) ?? []);
}

/**
 * Returns true when `candidate` preserves every kanji that appears in `raw`.
 * Prevents the +る / +い / godan rotators from producing forms that silently
 * drop part of the kanji compound (e.g. raw 食べる → never accept candidate る).
 */
function preservesKanji(raw: string, candidate: string): boolean {
  const rawKanji = extractKanjiSet(raw);
  if (rawKanji.size === 0) return true;
  for (const k of rawKanji) {
    if (!candidate.includes(k)) return false;
  }
  return true;
}

/**
 * Produces the dictionary-lookup forms to try for a single raw term.
 *
 * Pass 1 (the existing exact-match batch query) consumes only the first
 * element (the raw term). Pass 2 (variant lookup for unmatched terms) uses
 * the full list:
 *
 *   1. raw term (as emitted by the model, NFKC-normalized)
 *   2. for each matching inflection ending:
 *      a. bare stem                          → noun / na-adjective
 *      b. stem + る                          → 一段 verb
 *      c. stem + い                          → い-adjective
 *      d. stem with i-row last → u-row       → 五段 verb
 *
 * Guards (see `_docs/scan-dictionary-fuzzy-match.md` § Guards):
 *   - stem ≥ MIN_STEM_LENGTH (or MIN_STEM_FOR_SHORT_ENDING for 1-char endings)
 *   - stem must contain at least one kanji (pure-kana stems strip too freely)
 *   - every generated candidate must preserve raw's kanji set
 */
export function buildNormalizedLookupForms(raw: string): string[] {
  const normalized = raw.normalize('NFKC');
  const forms = new Set<string>([normalized]);

  // Curated te-form / ta-form → base lookup. Handles cases the algorithmic
  // stripper misses because godan te-form has 1:N inverse (って → つ/う/る etc.).
  const curatedBase = lookupTeFormBase(normalized);
  if (curatedBase) forms.add(curatedBase);

  for (const ending of INFLECTION_ENDINGS) {
    if (!normalized.endsWith(ending)) continue;
    const stem = normalized.slice(0, -ending.length);
    const minStem = ending.length === 1 ? MIN_STEM_FOR_SHORT_ENDING : MIN_STEM_LENGTH;
    // Single-kanji stems are dict entries on their own (見, 高, 食, …) so
    // we exempt them from the regular length floor. They still have to pass
    // the kanji-required guard below.
    const isSingleKanjiStem = stem.length === 1 && SINGLE_KANJI_REGEX.test(stem);
    if (stem.length < minStem && !isSingleKanjiStem) continue;
    if (!containsKanji(stem)) continue;

    const candidates = [
      stem,
      `${stem}る`,
      `${stem}い`,
    ];
    const lastChar = stem[stem.length - 1];
    const uRow = I_ROW_TO_U_ROW[lastChar];
    if (uRow) candidates.push(`${stem.slice(0, -1)}${uRow}`);

    for (const candidate of candidates) {
      if (!preservesKanji(normalized, candidate)) continue;
      forms.add(candidate);
    }
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

/**
 * Tags a pass-1 dictionary hit with the most specific `matchSource` we can
 * infer without tracking which DB column matched:
 *   - raw === dict term     → 'exact' (clean direct hit)
 *   - raw === dict reading  → 'reading' (model emitted kana, dict has kanji form)
 *   - otherwise             → 'inflection' (Jisho substituted a base form)
 *
 * Pass 2 sets matchSource explicitly from its own variant-origin map, so this
 * helper is only for the pass-1 paths.
 */
function tagPass1Match(raw: string, word: ExtractedWord): ExtractedWord {
  if (!word.dictionaryEntryId) return word;
  const rawNormalized = raw.normalize('NFKC');
  if (word.term === rawNormalized) return { ...word, matchSource: 'exact' };
  if (word.reading === rawNormalized) return { ...word, matchSource: 'reading' };
  return { ...word, matchSource: 'inflection' };
}

interface PassContext {
  lookupTargets: string[];
  resultMap: Map<string, ExtractedWord>;
  hints: Map<string, ExtractedWord>;
  locale: string;
  signal: AbortSignal;
  isCancelled: () => boolean;
}

interface SplitPassContext extends Omit<PassContext, 'hints'> {
  splitReplacements: Map<string, ExtractedWord[]>;
}

type VariantKind = 'inflection' | 'reading';

/**
 * Pass 2 — variant lookup for terms with no dictionary match after pass 1.
 *
 * For each still-unmatched raw term we build a pool of:
 *   - inflection-stripped candidates (bare stem, +る, +い, godan u-row)
 *   - the model's hint reading (hiragana)
 *
 * All variants across all raws are flattened into ONE batch request. Hits
 * are mapped back to their source raw via the `variantOrigins` reverse
 * index, then scored with the existing `toExtractedWord` pipeline. The
 * winning entry's variant kind decides whether `matchSource` is
 * `'inflection'` or `'reading'`.
 */
async function runVariantLookupPass(ctx: Omit<PassContext, never>): Promise<void> {
  const stillUnmatched: string[] = [];
  for (const raw of ctx.lookupTargets) {
    const existing = ctx.resultMap.get(raw);
    if (!existing || existing.dictionaryEntryId == null) stillUnmatched.push(raw);
  }
  if (stillUnmatched.length === 0) return;

  type Origin = { raw: string; kind: VariantKind };
  const variantOrigins = new Map<string, Origin[]>();
  const pushOrigin = (variant: string, origin: Origin) => {
    const list = variantOrigins.get(variant);
    if (list) list.push(origin);
    else variantOrigins.set(variant, [origin]);
  };

  for (const raw of stillUnmatched) {
    const normalized = raw.normalize('NFKC');
    for (const v of buildNormalizedLookupForms(raw)) {
      if (v === normalized) continue;
      pushOrigin(v, { raw, kind: 'inflection' });
    }
    const hintReading = ctx.hints.get(raw)?.reading?.normalize('NFKC');
    if (hintReading && hintReading.length >= 2 && hintReading !== normalized) {
      pushOrigin(hintReading, { raw, kind: 'reading' });
    }
  }

  const variantList = [...variantOrigins.keys()];
  if (variantList.length === 0) return;

  let batchResult: Awaited<ReturnType<typeof searchDictionaryBatch>>;
  try {
    batchResult = await searchDictionaryBatch(variantList, ctx.locale, {
      signal: ctx.signal,
    });
  } catch (err) {
    if (ctx.signal.aborted) return;
    // Variant lookup is best-effort — if it fails we just keep the
    // existing pass-1 fallback (model hint, matchSource=null).
    console.warn('[scan] variant lookup failed', err);
    return;
  }
  if (ctx.isCancelled()) return;

  // Aggregate per raw: candidate entries + their source kind. A single
  // entry can be reached via multiple variants (e.g. both inflection AND
  // reading); we keep the FIRST kind seen so inflection (added first below)
  // wins ties — matches the user-facing "inflection" framing of the most
  // common correction case.
  const rawToGroups = new Map<
    string,
    Array<{ entries: DictionaryEntry[]; kind: VariantKind }>
  >();
  for (const [variant, entries] of batchResult.found) {
    const origins = variantOrigins.get(variant);
    if (!origins) continue;
    for (const { raw, kind } of origins) {
      const arr = rawToGroups.get(raw);
      if (arr) arr.push({ entries, kind });
      else rawToGroups.set(raw, [{ entries, kind }]);
    }
  }

  for (const [raw, groups] of rawToGroups) {
    if (ctx.isCancelled()) return;
    const entryKinds = new Map<string, VariantKind>();
    const allEntries: DictionaryEntry[] = [];
    for (const { entries, kind } of groups) {
      for (const e of entries) {
        if (!entryKinds.has(e.id)) entryKinds.set(e.id, kind);
        allEntries.push(e);
      }
    }
    const result = toExtractedWord(raw, allEntries, ctx.locale, ctx.hints.get(raw));
    if (!result.dictionaryEntryId) continue;
    const kind = entryKinds.get(result.dictionaryEntryId) ?? 'inflection';
    ctx.resultMap.set(raw, { ...result, matchSource: kind });
  }
}

/**
 * Pass 3 — 2-2 kanji split fallback.
 *
 * Triggered only when:
 *   - the raw term has no dict match after pass 2
 *   - the term is exactly 4 characters
 *   - all 4 characters are kanji
 *
 * Both halves must resolve in the dictionary. Partial matches reject the
 * split so proper nouns (e.g. 大谷翔平 — 大谷 hits but 翔平 doesn't) and
 * unregistered compounds stay intact as a `matchSource=null` model output.
 */
async function runSplitFallbackPass(ctx: SplitPassContext): Promise<void> {
  const candidates: Array<{ raw: string; left: string; right: string }> = [];
  for (const raw of ctx.lookupTargets) {
    const existing = ctx.resultMap.get(raw);
    if (existing?.dictionaryEntryId) continue;
    const normalized = raw.normalize('NFKC');
    if (normalized.length !== 4) continue;
    if (![...normalized].every((c) => KANJI_CHAR_REGEX.test(c))) continue;
    candidates.push({
      raw,
      left: normalized.slice(0, 2),
      right: normalized.slice(2, 4),
    });
  }
  if (candidates.length === 0) return;

  const halves = new Set<string>();
  for (const c of candidates) {
    halves.add(c.left);
    halves.add(c.right);
  }

  let batchResult: Awaited<ReturnType<typeof searchDictionaryBatch>>;
  try {
    batchResult = await searchDictionaryBatch([...halves], ctx.locale, {
      signal: ctx.signal,
    });
  } catch (err) {
    if (ctx.signal.aborted) return;
    console.warn('[scan] split fallback lookup failed', err);
    return;
  }
  if (ctx.isCancelled()) return;

  for (const c of candidates) {
    if (ctx.isCancelled()) return;
    const leftEntries = batchResult.found.get(c.left);
    const rightEntries = batchResult.found.get(c.right);
    if (!leftEntries?.length || !rightEntries?.length) continue;

    const leftWord = toExtractedWord(c.left, leftEntries, ctx.locale);
    const rightWord = toExtractedWord(c.right, rightEntries, ctx.locale);
    if (!leftWord.dictionaryEntryId || !rightWord.dictionaryEntryId) continue;

    ctx.splitReplacements.set(c.raw, [
      { ...leftWord, matchSource: 'split' },
      { ...rightWord, matchSource: 'split' },
    ]);
  }
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
      // OCR is app-only now — the scan page gates non-native runtimes, but
      // the store guards too in case it's ever wired up from elsewhere.
      if (!isNativeApp() || getSnapshot().active === null) {
        throw new Error('ai_model_not_ready');
      }
      const useGemma = true;
      const collectedTerms: string[] = [];
      const hints = new Map<string, ExtractedWord>();

      for (const imageDataUrl of imageDataUrls) {
        if (get().cancelId !== id) return;
        const words = await extractViaBridge(
          imageDataUrl,
          locale,
          controller.signal,
        );
        for (const w of words) {
          collectedTerms.push(w.term);
          if (!hints.has(w.term)) hints.set(w.term, w);
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

      // Track which raw terms got replaced by a 2-2 kanji split in pass 3.
      // Split halves bypass the normal resultMap lookup so that the original
      // raw term is removed from the output and the two halves take its slot.
      const splitReplacements = new Map<string, ExtractedWord[]>();

      if (lookupTargets.length > 0) {
        set({ status: 'enriching', enrichProgress: { current: 0, total: lookupTargets.length } });

        // ── Pass 1a: batch lookup by raw term ────────────────────────────
        const batchResult = await searchDictionaryBatch(lookupTargets, locale, {
          signal: controller.signal,
        });
        if (get().cancelId !== id) return;

        for (const [term, entries] of batchResult.found) {
          const word = toExtractedWord(term, entries, locale, hints.get(term));
          resultMap.set(term, tagPass1Match(term, word));
        }

        const batchFoundCount = batchResult.found.size;
        set({ enrichProgress: { current: batchFoundCount, total: lookupTargets.length } });

        // ── Pass 1b: per-missing Jisho fallback (one at a time) ──────────
        for (let i = 0; i < batchResult.missing.length; i++) {
          if (get().cancelId !== id) return;

          const raw = batchResult.missing[i];
          if (i > 0) await new Promise((r) => setTimeout(r, 200));

          try {
            const entries = await searchDictionary(raw, locale, {
              signal: controller.signal,
            });
            const word = toExtractedWord(raw, entries, locale, hints.get(raw));
            resultMap.set(raw, tagPass1Match(raw, word));
          } catch {
            if (controller.signal.aborted) return;
            resultMap.set(raw, hints.get(raw) ?? { term: raw, reading: '', meaning: '', jlptLevel: null });
          }
          set({
            enrichProgress: { current: batchFoundCount + i + 1, total: lookupTargets.length },
          });
        }

        // ── Pass 2: variant lookup for terms still without a dict match ──
        // Builds a flat pool of inflection-stripped + reading variants for
        // every still-unmatched raw term, runs ONE batch query, then maps
        // hits back to their source raw(s) via the origins map.
        await runVariantLookupPass({
          lookupTargets,
          resultMap,
          hints,
          locale,
          signal: controller.signal,
          isCancelled: () => get().cancelId !== id,
        });
        if (get().cancelId !== id) return;

        // ── Pass 3: 2-2 kanji split fallback ─────────────────────────────
        // Only attempted on still-unmatched 4-kanji terms. Both halves must
        // resolve in the dictionary; partial matches reject the split so
        // proper nouns and unregistered compounds stay intact.
        await runSplitFallbackPass({
          lookupTargets,
          resultMap,
          splitReplacements,
          locale,
          signal: controller.signal,
          isCancelled: () => get().cancelId !== id,
        });
        if (get().cancelId !== id) return;
      }

      if (get().cancelId !== id) return;

      // Build final list — a split raw term expands into its halves at the
      // original slot; everything else falls back through resultMap → hint.
      const results: ExtractedWord[] = [];
      for (const raw of filteredTerms) {
        const splits = splitReplacements.get(raw);
        if (splits) {
          results.push(...splits);
          continue;
        }
        results.push(
          resultMap.get(raw) ??
            hints.get(raw) ?? { term: raw, reading: '', meaning: '', jlptLevel: null },
        );
      }

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
