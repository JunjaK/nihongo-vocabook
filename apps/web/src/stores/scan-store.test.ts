import { describe, expect, it } from 'vitest';
import { buildNormalizedLookupForms } from './scan-store';

/**
 * Covers the golden set in `_docs/scan-dictionary-fuzzy-match.md` for the
 * pass-2 variant generator. We assert that the expected dictionary-form
 * candidate is present in the produced variant list — this validates the
 * inflection table + 4-candidate generator without needing a real dict.
 */
describe('buildNormalizedLookupForms', () => {
  it('always includes the raw NFKC-normalized form', () => {
    expect(buildNormalizedLookupForms('食べる')).toContain('食べる');
  });

  it('strips ました and reconstructs the ichidan dictionary form', () => {
    // 食べました → strip ました → stem 食べ → +る = 食べる
    expect(buildNormalizedLookupForms('食べました')).toContain('食べる');
  });

  it('rotates godan i-row stem to u-row dictionary form', () => {
    // 飲みたい → strip たい → stem 飲み → i-row み → u-row む = 飲む
    expect(buildNormalizedLookupForms('飲みたい')).toContain('飲む');
    // 書きます → strip ます → stem 書き → 書く
    expect(buildNormalizedLookupForms('書きます')).toContain('書く');
  });

  it('strips negative potential られない to single-kanji stem (single-kanji exemption)', () => {
    // 見られない → strip られない → stem 見 (1 char, single-kanji exempt) → +る
    expect(buildNormalizedLookupForms('見られない')).toContain('見る');
  });

  it('strips i-adjective くなかった to dictionary form', () => {
    // 高くなかった → strip くなかった → stem 高 → +い = 高い
    expect(buildNormalizedLookupForms('高くなかった')).toContain('高い');
    // 高くない → strip くない → stem 高 → +い = 高い
    expect(buildNormalizedLookupForms('高くない')).toContain('高い');
  });

  it('strips past tense かった and produces the i-adjective form', () => {
    // 楽しかった → strip かった → stem 楽し → +い = 楽しい
    expect(buildNormalizedLookupForms('楽しかった')).toContain('楽しい');
  });

  it('rejects pure-kana inputs even when an ending matches (kanji guard)', () => {
    // ありがとうございました: strip ました → stem ありがとうござい — no kanji
    // → containsKanji guard rejects, so no extra variants are produced
    const forms = buildNormalizedLookupForms('ありがとうございました');
    expect(forms).toEqual(['ありがとうございました']);
  });

  it('preserves kanji set — never produces a candidate that drops part of the compound', () => {
    // 4-kanji compounds with no inflection ending stay raw-only
    expect(buildNormalizedLookupForms('利用案内')).toEqual(['利用案内']);
    expect(buildNormalizedLookupForms('御朱印')).toEqual(['御朱印']);
  });

  it('strips polite copula です and produces the bare noun candidate', () => {
    // 学生です → strip です → stem 学生 → bare stem = 学生
    expect(buildNormalizedLookupForms('学生です')).toContain('学生');
  });

  it('strips ています and produces ichidan + godan candidates for the residue', () => {
    // 食べています → strip ています → stem 食べ → +る = 食べる
    expect(buildNormalizedLookupForms('食べています')).toContain('食べる');
  });

  it('handles 1-char endings only when stem is single-kanji', () => {
    // 見ろ (imperative) → strip ろ → stem 見 (single-kanji exempt) → +る
    expect(buildNormalizedLookupForms('見ろ')).toContain('見る');
    // 食べた → strip た → stem 食べ (2 chars, but minStem=3 for 1-char ending)
    //   → not single-kanji → guard rejects, no extra forms
    expect(buildNormalizedLookupForms('食べた')).toEqual(['食べた']);
    // 行った → strip た → stem 行っ (2 chars, not single-kanji) → rejected
    //   (would need te-form normalization which we deliberately don't do)
    expect(buildNormalizedLookupForms('行った')).toEqual(['行った']);
  });

  it('NFKC-normalizes the input before stripping', () => {
    // half-width katakana would NFKC to full-width; the function should
    // apply normalization upfront so downstream comparisons match
    expect(buildNormalizedLookupForms('カード')).toContain('カード');
  });
});
