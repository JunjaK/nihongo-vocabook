---
name: quiz-maintainer
description: |
  Quiz and practice maintenance rules for Nihongo VocaBook. Read when modifying quiz
  or practice UI, changing badge counts, adjusting session behavior, updating
  wordbook-to-quiz entry points, modifying priority/mastered state, changing flashcard
  components, or updating related i18n. Applies to files like quiz/page.tsx,
  flashcard.tsx, practice-flashcard.tsx, bottom-nav.tsx, or spaced-repetition logic.
---

# Quiz Maintainer

## Purpose

Operational rules to prevent regressions when modifying quiz/practice features. UI changes and data logic changes tend to intermix and cause bugs — this skill enforces separation and safe data-path usage.

## Core Principles

- Separate UI changes from logic changes in distinct steps.
- Distinguish practice mode (wordbook-based) from SRS quiz (review-based).
- Prefer the `user_word_state` path for user state values.
- Use i18n keys for all user-facing strings.
- Document key changes and verification points in `_docs/`.

---

## Mode Distinction Rules

### SRS Mode (`/quiz` or `/quiz?wordId=...`)
- Based on `repo.study` review flow.
- Subject to mid-session restore on re-entry.
- Save session snapshot with: current word identifier, progress count, session stats, timestamp.
- Discard snapshot on TTL expiry.

### Practice Mode (`/quiz?wordbookId=...`)
- Wordbook word traversal with priority/mastered handling.
- Random word selection, purely priority-based (no SRS algorithm).
- NOT subject to session restore.

### Quick Start (`/quiz?quickStart=1`)
- Random session of `newPerDay` count.
- Always start fresh — no session restore.

---

## Data Path Rules

### Priority Changes
- Modify `user_word_state`, NOT the `words` table directly.
- Always go through the repository API.
- Preferred API: `repo.words.setPriority(wordId, priority)`.

### Mastered State
- Use `repo.words.setMastered(wordId, boolean)`.
- After success, invalidate related caches (`words`, `mastered`, optionally `wordbooks`).

### Adding Words from Subscribed Wordbooks
- Normalize subscribed words as owned words when adding to a personal wordbook.
- Check mastered state scoped to `(user_id, word_id)`.

---

## UI Rules

- Maintain low-saturation dark palette consistency for practice/quiz buttons.
- When aligning `flashcard` and `practice-flashcard` visual styles:
  - Do NOT change click action logic.
  - Only adjust state presentation contrast (selected/unselected).
- Handle loading UI inside the card component itself.
- Branch bottom fixed buttons by page context (owned/subscribed, mode).

---

## Badge & Sync Rules

- Bottom nav quiz badge count: based on `repo.study.getDueCount()`.
- Trigger immediate refresh (beyond the 60s polling interval) at these points:
  - After review/mastered/priority save (when applicable).
  - On quiz screen exit.
  - On focus/visibility restore.

---

## Session Persistence Rules

- **SRS mode**: Save and restore session snapshots.
  - Minimum saved fields: current word identifier, progress count, session stats, timestamp.
  - Discard on TTL expiry.
  - Use localStorage with KST midnight reset (not browser local timezone).
- **Practice mode and Quick Start**: No session restore.

---

## Pre-Commit Checklist

Before completing quiz/practice changes, verify:

- [ ] Mode-specific requirements (SRS/Practice/Quick Start) are properly separated
- [ ] Changes to user state use `user_word_state` path, not `words` table directly
- [ ] UI changes do not break existing click logic
- [ ] i18n triad (`types.ts`, `en.ts`, `ko.ts`) is synchronized
- [ ] `_docs/` documentation reflects the latest changes
- [ ] Changed files pass lint

---

## Frequently Modified Files

| Category | Files |
|----------|-------|
| Quiz pages | `src/app/(app)/quiz/page.tsx` |
| Practice pages | `src/app/(app)/wordbooks/[id]/practice/page.tsx` |
| Flashcard components | `src/components/quiz/flashcard.tsx`, `src/components/quiz/practice-flashcard.tsx` |
| Navigation | `src/components/layout/bottom-nav.tsx` |
| Repository | `src/lib/repository/supabase-repo.ts`, `src/lib/repository/indexeddb-repo.ts`, `src/lib/repository/types.ts` |
| i18n | `src/lib/i18n/types.ts`, `src/lib/i18n/ko.ts`, `src/lib/i18n/en.ts` |
| Docs | `_docs/*quiz*.md` |
