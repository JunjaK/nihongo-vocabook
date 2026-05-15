# Scan: Dictionary Fuzzy Match for OCR-Extracted Terms

> Status: Feedback

## Background

OCR/Gemma extraction in `apps/web/src/stores/scan-store.ts` currently looks up
each extracted term in the dictionary (`searchDictionaryBatch` → `/api/dictionary/batch`)
using **only the raw term string**. The batch endpoint matches `term.in.()` OR
`reading.in.()` exactly — kana variants are the only normalization.

This misses three large categories of legitimate matches:

1. **Inflected forms** the model failed to normalize (`食べました` instead of `食べる`)
2. **Reading-only hits** (model got the reading right but the kanji wrong)
3. **Compound terms** the model didn't decompose (`利用案内` vs `利用` + `案内`)

The existing `buildNormalizedLookupForms` helper does inflection-stripping but
is used **only in `scoreDictionaryCandidate`** (scoring already-found candidates)
— not in the query phase. So if the dictionary contains `食べる` and the model
emitted `食べました`, no row is even returned to score against.

## Spec

### Two-pass lookup

```
Pass 1 (existing): batch lookup by raw term
   │
   ▼ for each term, did we get a hit?
   │
   ├─ yes → toExtractedWord (existing scoring path) → matchSource='exact'
   │
   └─ no → enter Pass 2
            │
Pass 2 (new): variant lookup
   │
   ├─ Build variant pool per unmatched term:
   │     • raw term itself (already tried, skip)
   │     • inflection-stripped stem + 4 candidate suffixes (bare/+る/+い/godan)
   │     • model's `reading` field (hiragana)
   │     • kana converted variants of the reading
   │
   ├─ Flatten all variants across all unmatched terms into one batch request
   │
   ├─ Group results back by original raw term using a reverse-map
   │
   ├─ Score candidates with scoreDictionaryCandidate (existing) + a small
   │     penalty when match came via variant (so an exact match always wins)
   │
   └─ Best candidate above threshold → matchSource∈{'inflection','reading'}
         (no match → fall through to Pass 3)

Pass 3 (new): compound split fallback (only for 4-kanji unmatched terms)
   │
   ├─ Split term[0:2] + term[2:4]
   │
   ├─ Look up both halves in dictionary
   │
   └─ Both halves matched → replace the original word with two new entries
         (cardinality changes) → matchSource='split' on both halves
```

### matchSource field

Added to `ExtractedWord`:

```ts
type MatchSource = 'exact' | 'inflection' | 'reading' | 'split' | null;
```

- `'exact'` — raw term matched directly in pass 1
- `'inflection'` — matched via inflection-stripped variant in pass 2
- `'reading'` — matched via reading-only lookup in pass 2
- `'split'` — produced by 2-2 split in pass 3
- `null` — no dictionary hit (preserves model output as-is)

UI in `word-preview.tsx` shows a small label for the three non-`exact` cases
so the user can see when the dictionary auto-corrected the model output.

## Inflection Table

Ordered **longest-first** within each group so specific endings strip before
generic ones. The applier walks the list and stops at the first match.

### Group 1 — Polite & copula

```
ませんでした, ましょう, ましても, ませんで, でしょう,
でした, ました, ません, である, だった, だろう, でしょ,
です, ます, だ
```

### Group 2 — Negative

```
くなかった, くなくて, なかった,
なくて, なければ, なくては,
ない, なきゃ
```

### Group 3 — Desiderative / propensity / aux

```
たかった, たくない, たくて,
たい, たく,
たがる, がち, がる,
やすい, にくい, がたい, すぎる, すぎた, そう
```

### Group 4 — Passive / causative / potential

```
させられる, させられた,
られない, られます, られた,
させない, させます, させた,
られる, させる, れる, せる, れた, せた
```

### Group 5 — い-adjective

```
くなかった, ければ,
かった, くない, くて, くなる, くする
```

### Group 6 — Te / Ta form (highest false-positive risk — strong guards)

```
ちゃう, じゃう, てしまう,
ています, ていた, ている,
ながら, つつ,
って, んで, いて, した, して,
たら, たり, ても, なら,
た, て        ← 1-char: stem must be ≥3 chars AND end in kanji
```

### Group 7 — Imperative / volitional / formal

```
ましょう, よう, ろ, なさい, ください, おる
```

## Candidate Generation Rules

After stripping a matching ending → stem `S`, produce up to 4 candidates:

| # | Candidate | Catches |
|---|-----------|---------|
| 1 | `S` (bare stem) | Noun, な-adjective, godan stem when stem is a kanji compound (e.g. 勉強 from 勉強する) |
| 2 | `S + る` | 一段 verb (e.g. 食べ → 食べる) |
| 3 | `S + い` | い-adjective (e.g. 高 → 高い) |
| 4 | `S[:-1] + U_ROW(S[-1])` | 五段 verb (e.g. 飲み → 飲む) |

i-row → u-row table:

```
き→く, ぎ→ぐ, し→す, じ→ず,
ち→つ, に→ぬ,
ひ→ふ, び→ぶ, ぴ→ぷ,
み→む, り→る, い→う
```

## Guards

These prevent the variant lookup from producing false matches:

1. **Min stem length ≥ 2** (1-char endings require stem ≥ 3)
2. **Stem must contain at least one kanji** — pure hiragana stems strip too aggressively
3. **Candidate must preserve raw's kanji set** — if raw has 食 and a candidate doesn't, reject
4. **Over-contraction guard re-applied** — `scoreDictionaryCandidate` already has this; we just reuse it
5. **Variant-match penalty** — when scoring, subtract a small constant from variant-source candidates so an exact match always beats an inflection match for the same raw term

## Compound Split Rules

Triggered only for:

- term has no dictionary match after pass 2
- term length === 4
- all 4 characters are kanji

Operation:

- Split into `left = term[0:2]`, `right = term[2:4]`
- Look up both in dictionary (single batch query for all candidate splits)
- **Both halves must match** — see outcome table below
- Replace original entry with two new entries, both marked `matchSource='split'`
- Preserve original position in the output array (insert in place)

### Split outcomes

| Case | Action | matchSource | Why |
|------|--------|-------------|-----|
| Both halves matched | Replace original with the two halves | `'split'` on both | Confident decomposition |
| Only one half matched | **Reject split — keep original whole** | `null` on original | Protects proper nouns (e.g. `大谷翔平` where `大谷` matches but `翔平` doesn't), neologisms, unregistered compounds |
| Neither half matched | Reject split — keep original whole | `null` on original | Split was wrong; preserve model output |

### No-drop invariant

**The original term is never dropped.** Any pass that fails to find a match
returns the model's hint (term + reading + meaning + jlptLevel) with
`matchSource: null` and `dictionaryEntryId: null`. This matches the existing
`toExtractedWord` fallback behavior. Vocabulary extraction is a recall-favoring
task — the user decides in the preview whether to keep or discard unknown
terms.

### Explicitly NOT attempted

- 3-1 / 1-3 splits (too much false-positive risk — single kanji halves rarely
  represent the user's intent)
- 5+ kanji splits (Gemma's own decomposition pass should have caught these)
- Splits where either half is a single common kanji (e.g. 大, 人, 中) — single
  kanji halves are rejected at the candidate level via `scoreDictionaryCandidate`'s
  single-kanji penalty even if they happen to match the dict

## File Changes

| File | Change |
|------|--------|
| `apps/web/src/stores/scan-store.ts` | Expand `buildNormalizedLookupForms` with full table + 4-candidate generator. Add pass 2 (variant lookup) and pass 3 (compound split) to `startExtraction`. Mark `matchSource`. |
| `apps/web/src/lib/dictionary/jisho.ts` | No change (existing batch endpoint accepts variants — we just call it again with the variant pool) |
| `apps/web/src/app/api/dictionary/batch/route.ts` | No change (already does `term.in.() OR reading.in.()`) |
| `apps/web/src/lib/ocr/llm-vision.ts` | Add `matchSource?: MatchSource` to `ExtractedWord` type |
| `apps/web/src/components/scan/word-preview.tsx` | Render badge when `matchSource ∈ {'inflection','reading','split'}` |
| `apps/web/src/lib/i18n/types.ts` + `ko.ts` + `en.ts` | New key `scan.match_source_corrected` ("사전 자동 보정" / "Auto-corrected") |

## Checklist

- [ ] Inflection table + 4-candidate generator in `buildNormalizedLookupForms`
- [ ] i-row → u-row converter
- [ ] Pass 2 variant lookup in `startExtraction`
  - [ ] Build reverse-map `variant → originalRawTerm[]`
  - [ ] Single batch request for all variants
  - [ ] Group results back, score, pick best per original term
  - [ ] Apply variant-match penalty in scoring
- [ ] Pass 3 compound split fallback
  - [ ] 4-kanji + still-unmatched filter
  - [ ] Both-halves-match check
  - [ ] Cardinality-changing replacement in result array
- [ ] `matchSource` field added to `ExtractedWord`
- [ ] `word-preview.tsx` label rendering
- [ ] i18n keys (ko + en + types)
- [ ] TS error zero check on all modified files
- [ ] Golden set manual verification

## Golden Test Cases

| Input (model output) | Expected dict match | matchSource |
|----------------------|---------------------|-------------|
| `食べました` | `食べる` (たべる) | inflection |
| `見られない` | `見る` (みる) | inflection |
| `高くなかった` | `高い` (たかい) | inflection |
| `飲みたい` | `飲む` (のむ) | inflection |
| `お弁当` | `弁当` (べんとう) | exact (existing honorific strip in inference.ts) |
| `御朱印` | `御朱印` (ごしゅいん) | exact (no split — 4 kanji but exact match exists) |
| `利用案内` (no dict hit) | `利用` + `案内` | split |
| `たべる` (hiragana only) | `食べる` | reading |
| `公園` | `公園` | exact |
| `ありがとうございました` | (no match, stem has no kanji → guard rejects) | null |

## Implementation Notes

### Single-kanji stem exemption (added during impl)

The original `MIN_STEM_LENGTH = 2` rule rejected stems like `見` (1 char)
produced by stripping `られない` from `見られない`. But single-kanji terms
(`見`, `高`, `食`) are legitimate dict entries on their own, and stripping
multi-suffix forms like `見られない → 見られ → 見ら → 見` is the only way
our single-pass stripping reaches the base form.

Added an `isSingleKanjiStem` exemption that allows length-1 stems when the
character is kanji. The `containsKanji` guard still applies on top, so
hiragana-only 1-char stems remain rejected.

### Pass-1 match source distinction (refined during impl)

Initial plan treated all pass-1 hits as `matchSource='exact'`. But Jisho's
fallback (pass 1b) can return base forms for inflected queries — e.g.
querying `食べました` returns `食べる`. That's a correction, not an exact
match.

`tagPass1Match(raw, word)` now distinguishes:

- `raw === dict term`     → `'exact'`
- `raw === dict reading`  → `'reading'` (model emitted kana, dict has kanji)
- otherwise               → `'inflection'` (Jisho substituted base form)

Pass 2 still sets `matchSource` explicitly from its variant-origin map
(can't be inferred from term/reading equality there).

### Te-form stripping deliberately incomplete (resolved by addendum below)

Group 6 includes `た` and `て` as 1-char strip endings (with stricter
min-stem guard). Multi-character te-form rules like `って → う/つ/る` (godan
verb te-form) would need verb-class detection (vs ichidan `食べて → 食べる`),
which adds significant complexity for a small gain.

**Resolved**: Addressed by the curated `te-form-map` addendum (see below).
A flat lookup table keyed on the full inflected form (e.g. `待って → 待つ`)
adds zero false positives at the cost of finite coverage.

## Addendum: Te-form curated mapping

### Why a curated table

Godan te/ta-form has a 1:N reverse mapping (`って → つ/う/る`, `んで → む/ぬ/ぶ`,
`いて → く/ぐ`). Recovering the right base from the suffix alone requires
verb-class knowledge we don't have at lookup time. Generating all plausible
inverses (algorithmic) is consistent with the rest of the pass-2 pipeline,
but adds candidates that depend on dict to filter — fine for in-vocabulary
kanji, but increases query payload and noise.

A curated table is the conservative pick: deterministic, zero false positives
for listed entries, easy to extend later. Coverage is bounded by the list size
(currently ~75 godan bases + 3 irregular × 6 stacked variants = ~470 entries).

### Implementation

`apps/web/src/lib/ocr/te-form-map.ts` — generator builds a `Map<inflected, base>`
at module load from:

- Godan bases grouped by suffix class (く / ぐ / す / つ / ぬ / ぶ / む / う / る)
- Conjugation rules per class (`書く → 書いて/書いた`, `読む → 読んで/読んだ`, etc.)
- Stacked te-iru family suffixes appended to te-form: `<te>`, `<te>いる`,
  `<te>いた`, `<te>います`, `<te>いました`, `<te>ください`
- Irregular: `行く / 来る / する` with both kanji and kana spellings

Wired into `buildNormalizedLookupForms`: `lookupTeFormBase(normalized)` runs
first; if a base is found, it is added to the lookup-form set alongside the
algorithmic candidates. Pass 1 / Pass 2 then query the dictionary as before.

### Coverage examples

| Raw | Base | Source |
|---|---|---|
| 待って | 待つ | curated (godan -つ) |
| 読んでいる | 読む | curated (te-iru stacked) |
| 話してください | 話す | curated (te-kudasai stacked) |
| 行った | 行く | curated (irregular) |
| 食べて | 食べる | algorithmic (existing `+る` candidate, 一段) |
| 食べた | 食べた | unchanged (1-char `た` strip, 2-char stem not single-kanji) |

### Out of scope (deferred until usage data warrants)

- Te-stacking beyond te-iru family (`〜てあげる / 〜てくる / 〜てしまう` etc.)
- Negative-past for godan verbs in the curated style (algorithmic already covers
  the `なかった` / `ません` / `ない` family for stems with kanji)
- Honorific te-form (`お書きになって`) — would conflict with the honorific
  prefix dedup elsewhere

## User Feedback

(to be filled after review)

## Final Summary

### Files changed

```
M apps/web/src/lib/ocr/llm-vision.ts            — MatchSource type + matchSource field
M apps/web/src/stores/scan-store.ts              — Full inflection table, passes 2 + 3, te-form-map wiring
A apps/web/src/stores/scan-store.test.ts         — vitest cases covering the golden set + te-form
A apps/web/src/lib/ocr/te-form-map.ts            — curated te/ta-form → base map (addendum)
A apps/web/src/lib/ocr/te-form-map.test.ts       — vitest cases for the curated map
M apps/web/src/components/scan/word-preview.tsx  — Auto-corrected badge
M apps/web/src/lib/i18n/types.ts                 — scan.autoCorrected key
M apps/web/src/lib/i18n/ko.ts                    — 사전 자동 보정
M apps/web/src/lib/i18n/en.ts                    — Auto-corrected
A _docs/scan-dictionary-fuzzy-match.md           — this doc
```

### Verification

- `bunx tsc --noEmit` → clean for all modified files (pre-existing errors
  in `assistant/sessions/page.tsx` and related i18n are unrelated to this
  work)
- `bunx eslint` on all modified files → clean
- `bun test src/stores/scan-store.test.ts` → 12 pass, 0 fail

### Latency cost

Per scan with N unmatched terms:

- Pass 2: +1 batch query (all variant strings flattened, deduped)
- Pass 3: +1 batch query (only when there are 4-kanji unmatched terms)

Both are simple `term.in.() OR reading.in.()` queries against the existing
`dictionary_entries` table; no schema change, no new index.

### Follow-ups (not in scope here)

- Verify on-device with real scan images (deferred until physical test)
- ~~If users complain about `行った`-class misses, add te-form table~~ — done
  via te-form-map addendum
- Expand the curated te-form list as usage data identifies misses (current ~75
  godan bases cover JLPT N5/N4; longer-tail verbs are easy to add)
- Consider exposing the matchSource as a tooltip/popover detail (currently
  only `title` attribute carries the specific kind)
