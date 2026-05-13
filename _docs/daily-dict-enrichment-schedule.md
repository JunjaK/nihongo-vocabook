# Schedule Registration — Daily Example Enrich

> Status: Ready to register (waiting on user)

Copy-paste guide for registering the routine in **Claude Desktop** via `/schedule create`. Mirrors the plan in [`daily-dict-enrichment-routine.md`](./daily-dict-enrichment-routine.md).

## Hard rule

**The routine agent (you, when this fires) writes example sentences and any kanji data directly — either inline or by dispatching sub-agents via the `Task` tool. NEVER call an external LLM API (Anthropic, OpenAI, etc.) from any routine script. The scripts in `apps/web/scripts/routines/` are DB-only and mail-only.**

## Prerequisites

- [ ] `RESEND_API_KEY` issued at https://resend.com (free tier 100/day, way more than needed)
- [ ] `NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION` ready to paste (copy from `apps/web/.env.local`)
- [ ] First run smoke-tested locally (see "Smoke test" below)

## Smoke test (local) — recommended before scheduling

```bash
cd ~/develop/personal/nihongo-vocabook

# 1. Fetch a few candidates
DAILY_CAP=3 bun apps/web/scripts/routines/fetch-example-candidates.ts > /tmp/candidates.json
cat /tmp/candidates.json

# 2. Manually craft a results.json by reading /tmp/candidates.json and writing
#    sentences yourself (use the authoring rules in the plan doc).
#    For testing you can copy candidates → results structure verbatim and
#    fill in placeholder sentences.

# 3. Insert
bun apps/web/scripts/routines/insert-examples.ts /tmp/results.json
```

Expected:
- `=== Stats ===` JSON block printed
- 6 example rows inserted, `source='claude-routine'`
- DB verify: `SELECT * FROM word_examples WHERE source='claude-routine' LIMIT 6;`
- If RESEND key present locally, email arrives at `haring157@gmail.com`

## Schedule prompt (paste into Claude Desktop /schedule create)

```
Register a daily routine for the nihongo-vocabook repo.

Schedule: 0 4 * * *  (UTC; = KST 13:00)
Timeout: 25 minutes
Retries: 0

Env (pass as schedule secrets):
  NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION=<copy from apps/web/.env.local>
  RESEND_API_KEY=<copy from resend dashboard>

----- Routine task (you, the scheduled agent, execute this) -----

cd into the nihongo-vocabook repo root.

Step 1 — Fetch candidates:
  bun apps/web/scripts/routines/fetch-example-candidates.ts > /tmp/candidates.json
  Read /tmp/candidates.json.
  If empty array → write "{}" to /tmp/results.json, jump to Step 3.

Step 2 — Author example sentences:
  Goal: 2 example sentences per candidate, following these rules:
    - sentence_ja: natural Japanese using the target word.
      JLPT N5–N3 grammar unless the word itself is advanced.
    - sentence_reading: full hiragana reading of the whole sentence.
    - sentence_meaning: natural Korean translation
      (use corner brackets 「」 for any quoted Japanese inside Korean text).
    - 10–25 characters JA per sentence.
    - The two sentences must show DIFFERENT contexts / conjugations of the
      target word — not paraphrases.
    - Do not leave the target word in dictionary form if it conjugates.

  Authoring mode:
    - If candidates.length <= 30: write all sentences yourself.
    - If > 30: dispatch sub-agents via the Task tool
      (subagent_type=general-purpose), chunked at ~20 entries per sub-agent,
      in parallel. Each sub-agent returns a partial JSON array; you
      concatenate them.

  *** DO NOT call any external LLM API (no fetch to anthropic.com,
  api.openai.com, etc.). You are the model. Write the sentences directly. ***

  Write the combined results to /tmp/results.json with this shape:
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

Step 3 — Insert + mail:
  bun apps/web/scripts/routines/insert-examples.ts /tmp/results.json

  Print the final "=== Stats ===" JSON block from stdout.

Failure handling:
  - If fetch script errors: report the error and exit. No mail (no RESEND key
    work to do; the routine simply failed).
  - If you cannot author for some entry (e.g. the term is too obscure to
    write good sentences), omit that entry from results.json. The insert
    script will count this as not processed.
  - If wall clock approaches 20 min, finalize whatever you have and run the
    insert script anyway — partial runs are acceptable.

Idempotent: safe to re-run. INSERT uses ON CONFLICT DO NOTHING.
```

## What success looks like

Day 1 (post-registration):
- Email arrives at 13:00 KST with `+100 entries (0A/100B)` showing 100 jisho-orphan entries filled
- Backlog B drops from ~547 to ~447

Day 5–6:
- Email shows `+45 entries (0A/45B)` — jisho orphan backlog exhausted
- Subsequent days: most likely no mail (suppressed when nothing processed) unless user adds new words

When user adds a new word:
- Next day's email contains 1A entry filled, mail sent

## Failure observability

- Mail subject `✗ failed` → check routine logs for the fatal error
- No mail for many consecutive days, then user adds a word but still no mail next day → check schedule is still active, env still injected
- Mail says `partial` → 20-min wall clock hit; lower `DAILY_CAP` env via `/schedule update`

## Rollback / disable

`/schedule delete daily-dict-enrich` in Claude Desktop. Scripts can also be invoked manually any time.
