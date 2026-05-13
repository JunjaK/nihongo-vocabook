# Daily Dictionary Enrichment Routine

> Status: Planning

## Spec

### Goal
A daily Claude scheduled agent that backfills two kinds of missing data in `dictionary_entries`:
1. Missing example sentences (2 per entry)
2. Missing `kanjis` / `kanji_readings` rows for kanji characters that appear in dict entry terms but were not in the original kanjidic2 seed (e.g. `溺`, `蜻`, `蜥`)

### Why now
- Jisho fallback path adds new dict entries with kanji that may not exist in the seeded `kanjis` table → `KanjiChar` hover returns 404 → user sees no kanji info
- Manual `/generate-examples` slash command requires the laptop awake; daily automation removes that friction

### Non-goals
- No new `dictionary_entry ↔ kanji` join table — render-time char scan stays as-is
- No on-the-fly backfill at write time (separate concern)
- No re-translation of already-filled fields
- No retroactive guess of `frequency` when unknown

### Decisions

**Field strategy for new kanji rows**:

| Field | Source | Fallback |
|---|---|---|
| `character` | dict entry term scan | required |
| `stroke_count` | `scripts/data/kanji-strokes.json` (Unihan/kanjivg) | `null` |
| `jlpt_level` | `scripts/data/jlpt-kanji.json` | `null` (jōyō-gai / hyōgaiji) |
| `grade` | `scripts/data/kyoiku-jouyou-kanji.json` (1–6 / 8 / 9 per kanjidic2 spec) | `null` |
| `frequency` | fixed `null` | — |
| `on_readings` | Opus 4.7, **N=3 multi-sample agreement** | skip kanji if all 3 disagree |
| `kun_readings` | same | same |
| `meanings` (EN, per reading) | Opus 4.7 | 1–3 short glosses |
| `meanings_ko` (per reading) | Opus 4.7 | same |

**Why multi-sample over self-reported confidence**: LLM self-confidence is poorly calibrated, especially for hyōgaiji which appear rarely in training data. 3-sample agreement (with non-zero temperature) catches hallucinations where the model is *confidently wrong*. A reading is accepted only if it appears in ≥2 of 3 samples. Meanings for a surviving reading: take the list that appears in ≥2 samples; if none, take the shortest of the 3 (most conservative).

**Why `frequency` stays null**: outside the seed corpus we'd be guessing. Better the hover card hide the field than show a wrong rank.

**Email transport**: Resend with sender `onboarding@resend.dev` (no DNS setup), recipient `haring157@gmail.com`.

**Schedule**: `0 4 * * *` UTC (= KST 13:00). Mid-afternoon KST so retries aren't fighting peak usage; email arrives during the day.

**Caps per run**:
- 100 dict entries for example generation
- 100 distinct kanji for `kanjis` insertion
- 15-minute wall clock

If backlog exceeds caps, **oldest-first** by `dictionary_entries.created_at` (DESC for examples — recent words user just added matter most; ASC for kanji — historical hyōgaiji that have been broken longest deserve attention first). Final ordering choice TBD in Phase 2.

### Pre-flight backlog check

Before scheduling, run once and record numbers in this doc:

```sql
WITH missing AS (
  SELECT DISTINCT m.c[1] AS ch
  FROM dictionary_entries d,
       regexp_matches(d.term, '[一-鿿㐀-䶿]', 'g') m(c)
  WHERE NOT EXISTS (SELECT 1 FROM kanjis k WHERE k.character = m.c[1])
)
SELECT
  (SELECT count(*) FROM missing) AS missing_kanji_unique,
  (SELECT count(*) FROM dictionary_entries d
     LEFT JOIN word_examples we ON we.dictionary_entry_id = d.id
     WHERE we.id IS NULL) AS dict_without_examples;
```

If `missing_kanji_unique > 500` → do a one-shot batch first; otherwise routine handles it in a few days.

Verify `溺` specifically is in the missing set (the canonical example).

---

## Checklist

### Phase 0 — Pre-flight (manual)
- [ ] Run backlog query above; record numbers here
- [ ] Confirm `溺` missing (sanity)
- [ ] Resend signup → `RESEND_API_KEY`
- [ ] Test mail: `curl -X POST https://api.resend.com/emails ...` to `haring157@gmail.com`
- [ ] Decide one-shot vs routine path based on backlog size

### Phase 1 — Static data files
- [ ] `apps/web/scripts/data/jlpt-kanji.json` — `{ "N5":[…80], "N4":[…170], "N3":[…370], "N2":[…380], "N1":[…1230] }` (tanos.co.uk vetted)
- [ ] `apps/web/scripts/data/kyoiku-jouyou-kanji.json` — `{ "1":[…80], "2":[…160], …, "6":[…], "8":[…], "9":[…] }` (MEXT 学年別配当表 + 常用漢字表 + 人名用漢字)
- [ ] `apps/web/scripts/data/kanji-strokes.json` — `{ "溺":13, … }` (Unihan kTotalStrokes or kanjivg)
- [ ] Each JSON has a `_meta` block with source URL + license + retrieval date
- [ ] Sanity unit test: files parse, list lengths within ±10% of expected

### Phase 2 — Routine script (`apps/web/scripts/routines/daily-dict-enrich.ts`)
- [ ] DB conn from `NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION` env (NOT `.env.local`)
- [ ] Load 3 static JSONs once
- [ ] Query candidates with caps applied
- [ ] Missing-kanji loop: 3 parallel Opus 4.7 calls (`anthropic-sdk-typescript`, `temperature: 0.5`), agreement filter, INSERT kanjis + kanji_readings (idempotent)
- [ ] Missing-examples loop: 1 Opus 4.7 call per entry (no multi-sample, lower stakes), INSERT word_examples (`ON CONFLICT DO NOTHING`)
- [ ] Aggregate stats object
- [ ] Resend email POST (success or failure variant)
- [ ] Exit 0 / 1

### Phase 3 — Schedule registration
- [ ] `/schedule create` cron `0 4 * * *`
- [ ] Inject env: `NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`
- [ ] Routine prompt: "Run `bun apps/web/scripts/routines/daily-dict-enrich.ts`, then send the stdout JSON summary back."
- [ ] First run: manual trigger; verify mail received

### Phase 4 — Verify
- [ ] After 3 daily cycles, spot-check 3 newly-inserted kanji on the live app — hover card renders
- [ ] Anthropic dashboard: cost within expectation (~$0.05–0.15/day)
- [ ] Email arrives within 1 min of schedule fire
- [ ] No UNIQUE constraint violations in logs

### Phase 5 — Optional follow-ups (out of scope for v1)
- [ ] Backfill `meanings_ko` for existing `kanji_readings` where empty (currently covered by `/api/kanji` fire-and-forget)
- [ ] If disagreement rate <1% over 30 days, drop to N=1 sampling

---

## Routine script outline

```ts
// apps/web/scripts/routines/daily-dict-enrich.ts
//
// 1. Connect via NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION
// 2. Load jlpt-kanji.json, kyoiku-jouyou-kanji.json, kanji-strokes.json
// 3. Find missing kanji (LIMIT 100), entries w/o examples (LIMIT 100)
// 4. Per missing kanji:
//    - static lookup jlpt/grade/strokes
//    - 3× Opus 4.7 (temp 0.5) for readings + meanings, in parallel
//    - agreeReadings(samples) — keep readings appearing in ≥2/3
//    - if 0 readings survive → skip, log warning
//    - INSERT kanjis ON CONFLICT DO NOTHING
//    - INSERT kanji_readings ON CONFLICT (character,reading,reading_type) DO NOTHING
// 5. Per dict entry: 1× Opus 4.7 for 2 sentences, INSERT word_examples ON CONFLICT DO NOTHING
// 6. Build stats, POST to Resend, exit
```

Agreement helper:

```ts
function agreeReadings(samples: Reading[][]): Reading[] {
  type Slot = { reading: Reading; count: number; allMeanings: Reading[] };
  const buckets = new Map<string, Slot>();
  for (const sample of samples) {
    for (const r of sample) {
      const key = `${r.type}:${r.reading}`;
      const slot = buckets.get(key) ?? { reading: r, count: 0, allMeanings: [] };
      slot.count++;
      slot.allMeanings.push(r);
      buckets.set(key, slot);
    }
  }
  return Array.from(buckets.values())
    .filter((s) => s.count >= 2)
    .map((s) => consolidateMeanings(s.allMeanings));
}
```

`consolidateMeanings`: per-language, choose the gloss list that appears in ≥2 samples; if no agreement, pick the shortest list.

---

## Email format

Subject: `[VocaBook] Daily enrich ✓ +5 kanji +12 examples` (success) / `[VocaBook] Daily enrich ✗ failed` (failure)

Body (simple HTML table):

```
Run finished 2026-05-13 13:04 KST
Duration: 4m 12s

Examples
  inserted: 12
  skipped (conflict): 0
  remaining backlog: 0

Kanji
  inserted: 5
  skipped (disagreement): 1   [蜾]
  remaining backlog: 0

New kanji:
  char  strokes  jlpt  grade  on        kun         meaning
  溺    13       —     —      デキ      おぼ.れる   drown, indulge
  …

Cost estimate: $0.08
```

---

## Failure modes

| Failure | Handling |
|---|---|
| DB connection fails | Exit 1; send error email if `RESEND_API_KEY` present |
| `RESEND_API_KEY` missing | Log to stdout, exit 0 — routine logs are the audit |
| LLM call network/rate-limit | Retry 1× with 30s backoff, then skip |
| LLM JSON parse fails | Skip item, increment `stats.parseFailures` |
| Multi-sample disagreement (all 3 differ) | Skip kanji, increment `stats.disagreements` |
| >5 consecutive LLM failures | Abort, send error email |
| Wall clock >15 min | Stop dispatch, finalize partial summary, mark `partial: true` in email |

---

## Open questions

- Static data licensing: tanos JLPT lists are scraped from public sources — include attribution + license in `_meta`. Verify before commit.
- Backfill ordering: examples DESC (recent user words) vs kanji ASC (oldest broken) — confirm after Phase 0 numbers.

---

## Implementation Notes

(Fill in as we go.)

## User Feedback

- 2026-05-13: option (A) confirmed (DB-level kanji insertion for hyōgaiji). Env injection via schedule. Caps 100 examples / 100 kanji. Resend `onboarding@resend.dev` → `haring157@gmail.com`. Multi-sample N=3 strategy for LLM-derived fields approved over self-reported confidence.

## Final Summary

(Post-completion.)
