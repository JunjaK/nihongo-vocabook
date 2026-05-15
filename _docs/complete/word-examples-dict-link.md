# Word Examples Dict Link Migration

> Status: Planning

## Spec

### Problem
`word_examples.word_id → words.id` ties example sentences to per-user rows. When user A generates examples for 「食べる」, user B's 「食べる」 sees nothing. Additionally, `words` has no FK to `dictionary_entries` — users can save arbitrary free-text today.

### Goals
1. Move `word_examples` FK to `dictionary_entries.id` (shared resource).
2. Force every `words` row to link to a `dictionary_entries.id` (term becomes canonical).
3. Enforce dict-first on word save (search → Jisho fallback → LLM fallback → block).
4. New dict entry creation auto-generates 2 example sentences (LLM, fire-and-forget).

### Non-goals
- Moving `user_word_state` / `study_progress` / `wordbook_items` to dict_entry keys (still per-user).
- Re-architecting shared wordbooks.

### Decisions
- **Guest save**: disabled → login CTA. IndexedDB `words` becomes read-only; offer export/sign-in modal.
- **Override**: only `words.term` canonical. `reading/meaning/notes/tags/jlpt_level` remain user-editable; render-time fallback to dict when empty.
- **Orphan cleanup**: normal term → upsert to dict & link; garbage term → delete word. Empty dict meanings filled from linked word.
- **Rollout**: single-shot migration. Personal project, one real user.

---

## Checklist

### Phase 0 — Audit (read-only)
- [ ] `apps/web/scripts/audit-word-dict-link.ts` created
- [ ] Audit run, user signs off on numbers (especially garbage count)

### Phase 1 — Migration `025_examples_share_via_dict.sql`
- [ ] Add nullable `dictionary_entry_id` to `words` and `word_examples`
- [ ] Upsert dict from normal words (JP-script regex, length bounds)
- [ ] Fill empty dict meanings from linked words
- [ ] Link words → dict by `(term, reading)`
- [ ] Delete garbage words (cascades)
- [ ] Backfill word_examples → dict
- [ ] Dedupe examples on `(dict_entry_id, sentence_ja)` keeping oldest
- [ ] `NOT NULL` + drop `word_examples.word_id`
- [ ] Unique indexes: `words(user_id, dict_entry_id)`, `word_examples(dict_entry_id, sentence_ja)`
- [ ] Swap RLS on `word_examples` (public read)

### Phase 2 — Code
- [ ] `types/word.ts` — Word + WordExample + CreateWordInput
- [ ] `supabase-repo.ts` — DbWord/DbWordExample, dbWordToWord dict join fallback, create, getExamples(+ForWords)
- [ ] `repository/types.ts` — interface signature update
- [ ] `indexeddb-repo.ts` — wordRepo.create returns LOGIN_REQUIRED
- [ ] `db/dexie.ts` v10 — drop `wordExamples` store
- [ ] `components/word/word-form.tsx` — submit gated on selectedDictEntryId, term read-only after pick
- [ ] `api/dictionary/route.ts` — await upsert, return dictionaryEntryId, trigger example gen on new insert
- [ ] `api/examples/generate/route.ts` (new) — Claude Sonnet, idempotent insert of 2 examples
- [ ] `stores/scan-store.ts` + `words/scan`, `create-by-image` — dictionaryEntryId flow, blocked items excluded
- [ ] Word create pages — login CTA when `!user`
- [ ] One-shot export/sign-in modal for legacy IndexedDB users
- [ ] `.claude/commands/generate-examples.md` — retarget to dict entries

### Phase 3 — Verify
- [ ] SQL invariants all zero/empty
- [ ] `bun run lint`, `bun test`, `bunx playwright test`
- [ ] Manual: create new word → examples appear after few seconds
- [ ] Manual: scan item with unresolved term is blocked
- [ ] Manual: guest sees login CTA

---

## Implementation Notes

(Decisions and changes during implementation — fill in as we go.)

## User Feedback

(Feedback records.)

## Final Summary

(Post-completion rewrite.)
