# Senior Developer Review — Words, Wordbooks, Mastered Pages

Date: 2026-02-25
Status: **All Critical and High issues resolved**

---

## Summary

Comprehensive review from a 10+ year senior Next.js developer perspective across three page areas: words list, wordbooks detail, and mastered words. Identified 28 issues across 4 severity levels.

---

## Critical (C) — All Fixed

### C1: N+1 Query in `wordbooks.getAll()` ✅
- **Problem**: Sequential `get_wordbook_mastered_count` RPC per wordbook
- **Fix**: Created batch RPC `get_wordbook_mastered_counts(wb_ids uuid[])`, rewrote `getAll()` with single batch call
- **Files**: `supabase-repo.ts`, `015_batch_rpcs.sql`

### C2: N+1 Query in `getSubscribed()` and `browseShared()` ✅
- **Problem**: Sequential RPC calls per wordbook for mastered counts and owner emails
- **Fix**: Created batch RPCs `get_wordbook_mastered_counts` and `get_user_emails(uids uuid[])`, rewrote both methods
- **Files**: `supabase-repo.ts`, `015_batch_rpcs.sql`

### C3: Race Condition in `loadMore` (Words Page) ✅
- **Problem**: Changing sort/query while `loadMore` is in-flight appends stale data
- **Fix**: Added `loadGenRef` generation counter; stale results discarded on return
- **Files**: `words/page.tsx`

### C4: List Cache is User-Blind ✅
- **Problem**: Module-level `Map<string, CacheEntry>` not invalidated on login/logout; user A sees user B's cached data
- **Fix**: Added `invalidateListCache()` call in `RepositoryProvider` when `userId` changes
- **Files**: `provider.tsx`

### C5: No Error Boundaries ✅
- **Problem**: Unhandled promise rejection in any page crashes the entire app with a white screen
- **Fix**: Added `src/app/error.tsx` and `src/app/(app)/error.tsx` with i18n support
- **Files**: `app/error.tsx`, `app/(app)/error.tsx`, i18n files

---

## High (H) — All Fixed

### H1: Mastered Page Loads All Words Without Pagination ✅
- **Problem**: `getMastered()` loads every mastered word at once; no virtual scroll
- **Fix**: Added `getMasteredPaginated()` to `WordRepository` interface and both implementations; rewrote mastered page with `@tanstack/react-virtual` + infinite scroll
- **Files**: `types.ts`, `supabase-repo.ts`, `indexeddb-repo.ts`, `mastered/page.tsx`

### H2: IndexedDB N+1 `getState()` Calls ✅
- **Problem**: `getAll()`, `getNonMastered()`, `search()`, `getWords()`, wordbook `getAll()` all do sequential `getState(id)` per word
- **Fix**: Added `getAllStates()` batch loader; refactored all methods to use `Promise.all` with `getAllStates()` and `bulkGet()`
- **Files**: `indexeddb-repo.ts`

### H3: Search Returns Mastered Words ✅
- **Problem**: `words.search()` queried `words` table directly, including mastered words
- **Fix**: Changed to query `v_words_active` view (excludes mastered server-side); IndexedDB search also filters mastered
- **Files**: `supabase-repo.ts`, `indexeddb-repo.ts`

### H4: Disabled `<Button>` Inside `<Link>` ✅
- **Problem**: `<Link href="/quiz"><Button disabled>` still navigates on click because `<Link>` wraps the disabled button
- **Fix**: Conditional rendering — disabled state renders plain `<Button>`, enabled state renders `<Link>` + `<Button>`
- **Files**: `words/page.tsx`

### H5: `handleUnmaster` Missing Cache Invalidation ✅
- **Problem**: Unmastering a word didn't invalidate wordbook cache (mastered counts stale) or refresh due count badge
- **Fix**: Added `invalidateListCache('wordbooks')` and `requestDueCountRefresh()`
- **Files**: `mastered/page.tsx`

### H6: Search + Unmaster Corrupts Cache ✅
- **Problem**: `setListCache('mastered', updated)` during active search writes filtered subset as full cache
- **Fix**: Removed stale cache pattern entirely in pagination rewrite; cache no longer used for mastered page
- **Files**: `mastered/page.tsx`

### H7: Wordbook Detail Sort Bug ✅
- **Problem**: Two separate memos (`sortedWords` + `filteredWords`) with missing `appliedQuery` dependency in `sortedWords`
- **Fix**: Consolidated into single `filteredWords` memo with correct `[words, appliedQuery, sortOrder]` dependencies
- **Files**: `wordbooks/[id]/page.tsx`

### H8: N Parallel `addWord` Calls ✅
- **Problem**: `add-words/page.tsx` fires `Promise.all(selectedIds.map(id => addWord(...)))` — N parallel requests
- **Fix**: Added `addWords(wordbookId, wordIds[])` batch method; Supabase impl batches owned words in single queries, falls back to individual for non-owned; IndexedDB uses single transaction
- **Files**: `types.ts`, `supabase-repo.ts`, `indexeddb-repo.ts`, `add-words/page.tsx`

---

## Medium (M) — Not Yet Addressed

### M1: `useRouter` Not Used (Words Page)
- Imported but previously unused (now used for H4 fix)

### M2: `sortWords` Called Inside Render (Mastered Page)
- Fixed implicitly by H1 rewrite (pagination handles sort server-side)

### M3: `isOwned` / `isSubscribed` Derived Every Render
- Minor; could use `useMemo` but cost is negligible

### M4: Wordbook Detail Not Using `pageWrapper` Style
- Inconsistent with other pages but functional

### M5: `handleSearch` / `handleSearchClear` Recreated Every Render
- Using `useSearch` hook now; stable references

### M6: No Optimistic UI for Mastered/Delete
- Could improve perceived performance but not critical

### M7: `incrementImportCount` TOCTOU Race ✅ (Fixed with C1/C2)
- Replaced read-then-write with atomic RPC `increment_import_count`

### M8: Missing `aria-label` on Some Buttons
- Accessibility improvement

### M9: Hard-coded `PAGE_SIZE` Not Configurable
- Works fine as constant

### M10: No Loading State for `loadMore`
- Fixed implicitly by H1 (mastered page shows loading indicator)

---

## Low (L) — Not Yet Addressed

### L1: `SortOrder` Type Duplicated Across Pages
- Mastered page defines its own `SortOrder` type vs `WordSortOrder` from types
- Fixed implicitly by H1 rewrite (now uses `WordSortOrder`)

### L2: `listContainer` Style vs Virtual Scroll Inconsistency
- Some pages use `listContainer` (stagger animation), others use virtual scroll

### L3: `SwipeableWordCard` Accepts Both `onSwipeAction` and `contextMenuActions`
- API could be simplified

### L4: `getWordSortOptions` vs Inline Sort Options
- Some pages use shared constant, others define inline

### L5: No Skeleton for Search Results
- Minor UX gap during search loading

---

## Migration Files Created

- `supabase/migrations/015_batch_rpcs.sql`
  - `get_wordbook_mastered_counts(wb_ids uuid[])` — batch mastered count
  - `get_user_emails(uids uuid[])` — batch email lookup
  - `increment_import_count(wb_id uuid)` — atomic increment

---

## Commits

1. `71b8a39` — feat: add card direction setting to flashcards and isOwned flag to Word type
2. `0ca6f0f` — feat: fix N+1 queries, race conditions, cache bugs, and add error boundaries
3. (pending) — H1-H8 fixes: pagination, IndexedDB optimization, cache/sort bugs, batch addWords
