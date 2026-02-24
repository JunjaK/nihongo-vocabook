# Quiz Split Review — 2026-02-24

Post-split analysis of practice/quiz separation and session persistence rewrite.

## Bugs

### 1. Stale Closure in Practice `handleSetPriority`

**File:** `src/app/(app)/wordbooks/[id]/practice/page.tsx:73-78`

The `setTimeout` callback captures `practiceIndex` and `practiceWords.length` at call time. If `handleMaster` fires during the 300ms delay (removing a word and shortening the array), the completion check uses stale values.

```tsx
// BUG: practiceIndex and practiceWords.length are stale inside setTimeout
setTimeout(() => {
  if (practiceIndex + 1 < practiceWords.length) {
    setPracticeIndex((i) => i + 1);
  } else {
    setPracticeComplete(true);
  }
}, 300);
```

**Fix:** Use refs or derive from state setter.

### 2. Stale `dueWords.length` in Quiz `handleMaster`

**File:** `src/app/(app)/quiz/page.tsx:269-273`

```tsx
setDueWords((prev) => prev.filter((_, i) => i !== currentIndex));
setCompleted((c) => c + 1);
if (currentIndex >= dueWords.length - 1) {  // stale: should be dueWords.length - 2
  setCurrentIndex(0);
}
```

`dueWords.length` still reflects the pre-filter length. After removing one item, the last valid index is `length - 2`, not `length - 1`.

### 3. Achievement `first_quiz` Uses UTC Date

**File:** `src/lib/quiz/achievements.ts:20-24`

```tsx
const stats = await repo.study.getDailyStats(
  new Date().toISOString().slice(0, 10),  // UTC — wrong at KST early morning
);
```

`toISOString()` returns UTC. At 8 AM KST (previous day 11 PM UTC), the check queries yesterday's stats. Should use `getLocalDateString()` from `date-utils.ts`.

### 4. Missing `invalidateListCache('wordbooks')` in Words Pages

When mastering from words list or word detail, wordbook counts go stale.

- `src/app/(app)/words/page.tsx:133-138` — `handleMaster` only invalidates `words`
- `src/app/(app)/words/[id]/page.tsx:79-85` — `handleToggleMastered` only invalidates `words` + `mastered`

Quiz page and practice page both correctly invalidate `wordbooks`.

## Consistency Issues

### 5. KST vs Browser-Local Timezone

| Module | Function | Timezone |
|--------|----------|----------|
| `session-store.ts` | `getKstDateString()` | KST (hardcoded) |
| `date-utils.ts` | `getLocalDateString()` | Browser local |
| `achievements.ts` | `toISOString().slice(0,10)` | UTC |

Session resets at KST midnight. DailyStats roll at local midnight. Achievement checks query UTC date. These three should agree.

## Code Quality

### 6. Duplicate Session Restore Logic

`quiz/page.tsx:66-125` — quickStart and general restore blocks are near-identical (~30 lines each). Should extract into a shared helper.

### 7. `cleanupLegacyKeys()` Runs Every Mount

Iterates all localStorage keys on every quiz page load. Should be gated behind a one-time flag.

### 8. Dead i18n Key `wordDetail.practiceWord`

Defined in `types.ts:112`, `en.ts:116`, `ko.ts:116` but never referenced. The old `?wordId=X` flow was removed.

## UX

### 9. Practice Header Shows Generic Title

`practice/page.tsx:148` uses `t.quiz.wordbookQuiz` instead of the actual wordbook name. Could fetch and display it.

### 10. QuickStart "Continue Studying" Behavior

On session report, "Continue Studying" calls `loadDueWords()` which checks `quickStart` from searchParams — starts another random batch, not a general quiz. May confuse users.

## Doc Drift

### 11. `quiz-improvements-2026-02.md` References Removed Patterns

Mentions `?wordbookId=X`, `SrsSessionSnapshot.currentWordId`, `getSrsSessionKey`, `restorableSrs` — all replaced by the split. Should be updated or annotated.
