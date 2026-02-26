# Quiz Flashcard Logic — Deep Analysis & Improvement Plan

> Status: Planning (reviewed)

## Context

Deep analysis of the entire quiz/flashcard system — UI layer, session management, SRS logic, data layer — to identify bugs, logic errors, and improvement opportunities while maintaining the existing architecture.

---

## Bug Analysis (Verified + Reviewed)

### BUG-1: Rating buttons clickable before card reveal (MEDIUM)

**Location:** `base-flashcard.tsx:130-133` → `renderActions` always rendered
**Problem:** All rating buttons (Again/Hard/Good/Easy/Master) are enabled and clickable even before the user taps the card to reveal the answer. A user can rate a word without ever seeing the back of the card. This corrupts SRS data (bad ratings) but doesn't crash or corrupt session state.
**Fix:** Pass `revealed` state to `renderActions` and disable buttons until `revealed === true`.
**Test impact:** 4 existing tests (`flashcard.test.tsx:201-259`) click rating buttons without revealing first. These will break and need to be updated to reveal first.

### BUG-2: Double-click causes duplicate DB writes (HIGH)

**Location:** `quiz/page.tsx:267-291`, `practice/page.tsx:78-96`
**Problem:** `handleRate`, `handleRecall`, and `handleMaster` are all async but not guarded against re-entrant calls. User can click two rating buttons before the first `await` resolves — both capture the same `dueWords[currentIndex]` via stale closure, causing duplicate `recordReview()` / `incrementPracticeStats()` calls and double stat increments.
**Fix:** Add `isProcessingRef = useRef(false)` guard to all three handlers in both pages.
**Scope note:** The ref is shared between `handleRate`/`handleRecall` and `handleMaster`, which is correct since they should never run concurrently. `handleContinueStudying` and `handleBackToHome` should NOT be gated by this ref — they are post-session actions with their own natural serialization.

### BUG-3: `handleMaster` in quiz has no error handling (MEDIUM)

**Location:** `quiz/page.tsx:293-314`
**Problem:** `handleMaster` calls `markWordMastered()` and `incrementMasteredStats()` without try/catch. If either throws, the error propagates uncaught and none of the subsequent state updates run (word not removed from queue, masteredCount not incremented). Session state becomes inconsistent.
**Fix:** Wrap in try/catch with toast error notification.

### BUG-4: `handleMaster` in practice has no error handling (MEDIUM)

**Location:** `practice/page.tsx:98-108`
**Problem:** Same as BUG-3 — `markWordMastered()` not wrapped in try/catch.
**Fix:** Wrap in try/catch.

---

## Consistency Notes (Not Bugs)

### NOTE-1: Practice Master button missing `onAdvance()` (LOW — SKIP)

**Location:** `practice-flashcard.tsx:65`
**Analysis:** Master button only calls `onMaster(w.id)` without `onAdvance()`. But the parent's `handleMaster` removes the word from the array, changing the key prop and forcing a re-mount that resets `revealed` to `false`. Behavior is correct — `onAdvance()` would be a no-op on an about-to-unmount component. Pattern is inconsistent with SRS flashcard but functionally identical.
**Decision:** Skip. Adding `onAdvance()` is harmless but pointless — it calls `setRevealed(false)` on a component that unmounts immediately after. Not worth the code churn.

### NOTE-2: `setCurrentIndex(currentIndex)` is dead code

**Location:** `quiz/page.tsx:313`
**Analysis:** After mastering a word and removing it from the array, `setCurrentIndex(currentIndex)` sets the index to its current value. This is a no-op — likely intended as a comment-like signal that "index stays the same" but does nothing.
**Decision:** Remove during implementation as cleanup.

---

## Non-Bug Issues (Lower Priority — SKIP)

### ISSUE-1: `useResolvedDirection` redundant logic (LOW — SKIP)

**Location:** `base-flashcard.tsx:21-28`
**Verdict:** Correct behavior. The return line handles the edge case where `direction` prop changes from `'random'` to concrete after mount. Leave as-is.

### ISSUE-2: Session persistence excessive writes (LOW — SKIP)

**Location:** `quiz/page.tsx:212-230`
**Verdict:** Multiple localStorage writes per card rating. Negligible perf impact.

### ISSUE-3: Timezone uses browser-local, not KST (INFO — MEMORY FIX ONLY)

**Location:** `date-utils.ts:4-10`
**Verdict:** Intentional. Session-store comment confirms "browser-local timezone." Fix MEMORY.md reference only.

---

## Improvement Plan

### Step 1: Add `revealed` guard to rating buttons

**Files:** `base-flashcard.tsx`, `flashcard.tsx`, `practice-flashcard.tsx`

- Update `BaseFlashcardProps.renderActions` type: add `revealed: boolean` to callback props
- Pass `revealed` in `renderActions` call at `base-flashcard.tsx:132`
- In `flashcard.tsx`: add `disabled={!revealed}` to all 5 buttons (4 rating + master)
- In `practice-flashcard.tsx`: add `disabled={!revealed}` to all 3 buttons (2 recall + master)

### Step 2: Add double-click guard to all async handlers

**Files:** `quiz/page.tsx`, `practice/page.tsx`

Add `isProcessingRef = useRef(false)` to both pages. Guard these handlers:

| Page | Handlers to guard |
|------|------------------|
| `quiz/page.tsx` | `handleRate`, `handleMaster` |
| `practice/page.tsx` | `handleRecall`, `handleMaster` |

Pattern:
```tsx
const handleRate = async (quality: number) => {
  if (isProcessingRef.current) return;
  isProcessingRef.current = true;
  try { /* existing logic */ }
  catch (error) { console.error(...); }
  finally { isProcessingRef.current = false; }
};
```

NOT guarded: `handleContinueStudying`, `handleBackToHome`, `handlePracticeAgain` — these are post-session actions.

### Step 3: Add error handling to `handleMaster` (both pages)

**Files:** `quiz/page.tsx:293-314`, `practice/page.tsx:98-108`

- Wrap both in try/catch (combined with Step 2's guard pattern)
- Show `toast.error(t.common.error)` on failure
- Ensure no state mutations happen before the DB calls complete

### Step 4: Cleanup dead code

**File:** `quiz/page.tsx:313`

- Remove `setCurrentIndex(currentIndex)` no-op

### Step 5: Update tests

**File:** `flashcard.test.tsx`

**Tests to update (currently broken after Step 1):**
- `calls onRate(3) on "Hard" click` — add `fireEvent.click(flashcard)` before rating click
- `calls onRate(4) on "Good" click` — same
- `calls onRate(5) on "Easy" click` — same
- `calls onMaster on "Master" click` — same

**Tests to add:**
- `rating buttons are disabled before reveal` — render card, assert all rating buttons are disabled
- `rating buttons are enabled after reveal` — render, tap card, assert buttons enabled

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/quiz/base-flashcard.tsx` | Pass `revealed` in `renderActions` callback |
| `src/components/quiz/flashcard.tsx` | Disable buttons when `!revealed` |
| `src/components/quiz/practice-flashcard.tsx` | Disable buttons when `!revealed` |
| `src/app/(app)/quiz/page.tsx` | Add `isProcessingRef` guard to `handleRate`/`handleMaster`, try/catch in `handleMaster`, remove dead code |
| `src/app/(app)/wordbooks/[id]/practice/page.tsx` | Add `isProcessingRef` guard to `handleRecall`/`handleMaster`, try/catch in `handleMaster` |
| `src/components/quiz/flashcard.test.tsx` | Fix 4 existing tests, add 2 new tests |

---

## Verification

1. `bun run test` — all existing (updated) + new tests pass
2. `bun run build` — no TypeScript errors
3. Manual: open quiz → buttons disabled before tap → tap card → buttons enable
4. Manual: rapid-click a rating button → only one rating recorded
5. Manual: master a word in practice → card advances, no error
6. Manual: simulate network error during master → toast error shown, session state intact
