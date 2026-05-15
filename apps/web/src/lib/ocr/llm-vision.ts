/**
 * Signals how an extracted term ended up linked to its dictionary entry, so the
 * preview UI can hint when the displayed form differs from what the model
 * originally emitted (e.g. inflection normalized, compound split).
 *
 * - `'exact'`     — raw model term matched directly
 * - `'inflection'` — matched after stripping a conjugation suffix
 * - `'reading'`   — matched via the model-provided hiragana reading
 * - `'split'`     — produced by decomposing a 4-kanji compound
 * - `null`        — no dictionary hit; model output preserved as-is
 */
export type MatchSource =
  | 'exact'
  | 'inflection'
  | 'reading'
  | 'split'
  | null;

export interface ExtractedWord {
  term: string;
  reading: string;
  meaning: string;
  jlptLevel: number | null;
  dictionaryEntryId?: string | null;
  matchSource?: MatchSource;
}
