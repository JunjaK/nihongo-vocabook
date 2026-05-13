# Daily Dictionary Enrichment Routine

> Status: In Progress (manual 7 done 2026-05-13; routine scripts ready; schedule registration remaining)

## Spec

### Goal
Daily Claude scheduled agent that keeps user-facing dictionary data complete:
- **Priority A** — generate examples for **user-linked** dict entries that have none (when user adds a new word)
- **Priority B** — when Priority A is empty, opportunistically fill jisho-orphan entries (search cache that user touched but didn't save) so re-visits show examples

### ⚠️ Authoring rule (firm)

**Claude (the agent driving this routine) authors example sentences AND any kanji data directly — by writing them itself or by dispatching sub-agents via the Task tool. No external LLM API (Anthropic API, OpenAI API, etc.) is ever called from this routine.**

Why: keeps the routine purely under Claude Code orchestration; no separate API keys to manage, bill, rotate; consistent voice/style with the manual backfills already in DB; sub-agents can be parallelized when the candidate set is large.

Scripts in this routine handle **only** DB I/O and mail transport — never LLM calls.

### Non-goals
- ❌ No JMDict seed example backfill (16,006 orphan jmdict entries → skip permanently)
- ❌ No kanji backfill in the daily routine (the 2 missing hyōgaiji 蝲, 蠊 were already manually inserted; future ones will be rare and handled ad-hoc by the agent, also without external LLM API)
- ❌ No frequency, no kanji metadata work
- ❌ No retroactive re-translation of populated fields
- ❌ **No fetch-to-anthropic.com or fetch-to-openai.com in any routine script — ever.** If a future change tempts you to add it, add a sub-agent dispatch instead.

### Phase 0 findings (2026-05-13)

Backlog query against production showed reality is very different from initial assumption:

| Metric | Value |
|---|---|
| `dictionary_entries` total | 24,671 |
| `word_examples` total | 15,608 (after manual 14 rows) |
| `kanjis` total | 10,386 (incl. 蝲, 蠊 manually inserted) |
| Missing kanji in any dict term | **0** ✓ |
| User-linked dict entries needing examples | **0** ✓ (was 7, now done) |
| jisho-orphan dict entries needing examples | 547 |
| jmdict-orphan dict entries needing examples | 16,006 (intentional, skip) |

Source × user-linked × has-examples cube (post-manual-backfill):

| source | ul_w_ex | ul_no_ex | orph_w_ex | orph_no_ex |
|---|---:|---:|---:|---:|
| jlpt-seed | 7,676 | 0 | 0 | 358 |
| jisho | 50 | 0 | 0 | 547 |
| jmdict | 29 | 0 | 0 | 16,006 |
| migrated | 5 | 0 | 0 | 0 |

### Decisions

**Priority order each run**:
1. Priority A — `user-linked AND no examples` (LIMIT 100, newest first)
2. Priority B — `jisho orphan AND no examples` (LIMIT 100 − count(A), oldest first)

Total cap per run: **100 dict entries = 200 example sentences**.

**Why exclude jlpt-seed and jmdict orphans from fallback**: they're not user-touched — nobody hovers them — generating examples is pure waste. Only `jisho` orphans (single-source proof a human searched the word) are worth filling.

**Frequency**: daily, cron `0 4 * * *` UTC (= KST 13:00).

**Authoring**: Claude agent. Two modes — pick per run based on candidate count:
- **Direct (≤ ~30 entries)**: main agent writes all sentences itself
- **Sub-agents (> ~30 entries)**: dispatch via `Task` tool, chunk by 20 entries per sub-agent, run in parallel; main agent aggregates results

**Email**: Resend `onboarding@resend.dev` → `haring157@gmail.com`. Subject pattern: `[VocaBook] Daily examples ✓ +N entries` / `✗ failed`.

**Termination conditions**:
- Wall clock > 20 min → finalize partial summary, mark `partial: true`
- Both priorities yield 0 candidates → suppress mail (already handled in `insert-examples.ts`)

**Run history**:
- 2026-05-13 (manual): 14 example rows inserted for サイネージ, 城跡, 滑子, 祠, 味気ない, 珈琲, 鯛 (`source='claude-manual'`). User-linked backlog cleared.

---

## Pre-flight (DONE)

- [x] Phase 0 backlog diagnostic ran and recorded above
- [x] DB backup taken to `~/Downloads/nihongo-vocabook-backup-2026-05-13/` (JSON-Lines per table, 24 MB, 16 tables, 105,711 rows)
- [x] Missing kanji 蝲, 蠊 manually inserted to `kanjis` + `kanji_readings`
- [x] Missing-example 7 user-linked entries manually backfilled (14 example rows)
- [x] Routine scripts written (DB-only)

## Open work

- [ ] **Resend account** — sign up, get `RESEND_API_KEY`, smoke-test mail delivery
- [ ] **Schedule registration** — user runs `/schedule create` in Claude Desktop (see [`daily-dict-enrichment-schedule.md`](./daily-dict-enrichment-schedule.md))
- [ ] **First run verification** — manual trigger, verify mail arrives and DB rows insert correctly
- [ ] **Separate fix** — `/api/dictionary/route.ts:289` server-to-server fetch loses session cookies → `/api/examples/generate` returns 401 → no examples ever auto-generated on word save (see [`dictionary-example-gen-auth-bug.md`](./dictionary-example-gen-auth-bug.md))

## Architecture

```
┌─────────────────────────────┐
│   Claude scheduled agent    │
│  (cron 0 4 * * *  UTC)      │
└──────────────┬──────────────┘
               │
               │  Step 1: fetch
               ▼
   ┌──────────────────────────┐
   │ fetch-example-candidates │  DB-only (postgres)
   │       .ts                │  outputs JSON to stdout
   └──────────┬───────────────┘
              │
              │  Step 2: agent authors examples
              ▼
   ┌──────────────────────────┐
   │ Claude agent (or         │  NO external API
   │  Task-dispatched         │  Writes JSON results file
   │  sub-agents)             │
   └──────────┬───────────────┘
              │
              │  Step 3: insert
              ▼
   ┌──────────────────────────┐
   │  insert-examples.ts      │  DB + Resend mail
   │                          │
   └──────────────────────────┘
```

### Script: `fetch-example-candidates.ts`

DB-only. Outputs candidate JSON on stdout. Shape per entry:
```json
{
  "id": "uuid",
  "term": "...",
  "reading": "...",
  "meanings": ["..."],
  "meanings_ko": ["..."] | null,
  "source": "jmdict" | "jisho" | ...,
  "priority": "A" | "B"
}
```

### Agent step — authoring (Claude)

For each candidate, produce 2 sentences obeying these rules:
- `sentence_ja`: natural everyday Japanese using the target word. JLPT N5–N3 grammar unless the word itself is advanced
- `sentence_reading`: full hiragana reading of the entire sentence
- `sentence_meaning`: natural Korean translation (corner brackets `「」` for any quotes)
- 10–25 chars JA
- Two sentences must show **different contexts/conjugations** of the word — not paraphrases
- Do not leave the target word in pure dictionary form when it conjugates

Output a results file with shape:
```json
[
  {
    "dictionary_entry_id": "<id from candidate>",
    "term": "...",
    "reading": "...",
    "priority": "A" | "B",
    "examples": [
      { "sentence_ja": "...", "sentence_reading": "...", "sentence_meaning": "..." },
      { "sentence_ja": "...", "sentence_reading": "...", "sentence_meaning": "..." }
    ]
  },
  ...
]
```

For >30 candidates, **dispatch sub-agents** via the `Task` tool with `subagent_type=general-purpose`, chunking by ~20 entries per sub-agent. Each sub-agent returns a partial JSON array; main agent concatenates them.

### Script: `insert-examples.ts <results.json>`

DB + Resend mail. Idempotent (`ON CONFLICT DO NOTHING`). Source tagged `'claude-routine'`. Validates sentence shape, tracks duplicates, computes backlog after, emails summary.

---

## Failure modes

| Failure | Handling |
|---|---|
| DB connection fails (either script) | Exit non-zero; if RESEND key set, the routine agent should attempt to mail the error itself |
| `RESEND_API_KEY` missing | `insert-examples.ts` logs and exits 0 — run still counts as successful |
| Agent JSON output malformed | `insert-examples.ts` increments `skippedInvalid` and continues |
| Agent runs > 20 min wall clock | Routine agent should stop dispatching new sub-agents, insert what it has, mark `partial: true` in mail |
| `>5` consecutive agent failures | Abort, send `✗ failed` mail with last error |
| Both priorities yield 0 candidates | `insert-examples.ts` suppresses mail (no inbox noise) |

## Implementation Notes

- 2026-05-13: discovered orphans are 94.6% jmdict seed — re-scoped from "1-shot 16k backfill" to "user-linked only + jisho fallback".
- 2026-05-13: `溺` already in `kanjis`; only 蝲, 蠊 missing. Inserted manually (source `manual-2026-05-13`).
- 2026-05-13: user-linked backlog of 7 backfilled manually with Claude-authored sentences (source `claude-manual`).
- 2026-05-13: separate bug discovered — `/api/dictionary/route.ts:289` fire-and-forget to `/api/examples/generate` fails 401 due to missing session cookies in server-to-server fetch. Tracked in `_docs/dictionary-example-gen-auth-bug.md`.
- 2026-05-14: refactored routine to be agent-driven — removed all `fetch('anthropic.com')` and similar; scripts handle DB + mail only. Authoring is Claude's job.

## User Feedback

- 2026-05-13: option (A) confirmed (DB-level kanji insertion). Caps 100/100. Resend `onboarding@resend.dev` → `haring157@gmail.com`.
- 2026-05-14: when Priority A is empty, fall back to jisho-orphan (100/day = 200 sentences/day). JMDict orphans permanently skipped.
- 2026-05-14: **firm rule — example sentences and any kanji data are authored by Claude directly (main agent or sub-agent dispatch). No external LLM API calls from any routine script.**

## Final Summary

(Post-routine-stable.)
