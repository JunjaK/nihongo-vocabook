# Quiz System Analysis (2026-02)

## 1. Senior Frontend Developer Perspective

### Architecture Overview

```
Entry Points                    State Layer              Data Layer               UI
─────────────                   ───────────              ──────────               ──
/quiz (general)    ──┐
/quiz?quickStart=1 ──┤─→ QuizContent ──→ localStorage ──→ DataRepository ──→ Flashcard
                     │   (page.tsx)      (session-store)   (supabase/dexie)     (4 ratings)
                     │
/wordbooks/[id]/   ──┘─→ PracticePage ──→ (ephemeral) ──→ DataRepository ──→ PracticeFlashcard
  practice               (page.tsx)                        (supabase/dexie)     (3 priorities)
```

### Two Study Modes

| Dimension | SRS Quiz (`/quiz`) | Practice Mode (`/wordbooks/[id]/practice`) |
|---|---|---|
| Word source | Global due queue (all words) | Single wordbook |
| Algorithm | FSRS (ts-fsrs library) | Priority-weighted random |
| Outcome | Updates `StudyProgress` in DB | Updates `priority` field in DB |
| Session persistence | localStorage, per-day | None (ephemeral) |
| Daily limits | Yes (newPerDay + maxReviewsPerDay) | No limits |
| Card type | `WordWithProgress` (has progress) | `Word` (no progress) |
| Completion | SessionReport screen | Simple "done" screen |
| Streak / Achievements | Yes | No |

### Strengths

- **Repository abstraction is solid.** Supabase and IndexedDB are properly hidden behind `DataRepository`. Quiz pages don't know or care which backend they're talking to.
- **Session restore is well-designed.** `QuizSessionSnapshot` saves only word IDs (not full objects), then re-fetches fresh data on restore. This prevents stale progress from being re-applied.
- **Due count sync via DOM events** (`quiz:due-count-refresh`) is a pragmatic alternative to pulling BottomNav into global state. Minimal coupling.

### Issues Found

#### P0 — Bug: QuickStart ignores daily new-card limit

`quiz/page.tsx:117-132` — QuickStart reads `settings.newPerDay` and uses it as the deck size, but never checks today's `DailyStats.newCount`. If the user already did 15 new cards via general SRS, QuickStart still deals 20 more. The daily limit becomes meaningless.

```typescript
// Current: no enforcement
const take = Math.min(Math.max(settings.newPerDay, 0), all.length);

// Should be:
const stats = await repo.study.getDailyStats();
const remaining = Math.max(0, settings.newPerDay - stats.newCount);
const take = Math.min(remaining, all.length);
```

#### P0 — Bug: `handleMaster` in quiz can leave stale index

`quiz/page.tsx:240-251` — When `handleMaster` filters out the current word and the new array is shorter, it resets to `currentIndex = 0`. But it doesn't call `advanceToNext()` or trigger `showReport`. This means:
- If only 1 word remained and gets mastered, `dueWords` becomes `[]`, no report shown, stuck on empty state with "All caught up" showing `completed > 0` count but no stats.
- The user loses their session stats (totalReviewed etc.) because `showReport` is never set.

#### P1 — Data: N+1 query pattern in session restore

`quiz/page.tsx:46-60` — `tryRestoreSession` calls `repo.words.getById(id)` individually for every word, then `repo.study.getProgress(w.id)` individually for every word. For a 20-word session, that's 40 parallel-but-individual Supabase RPCs. A `getByIds(ids[])` batch method would be far cheaper.

#### P1 — Structural: 90%+ code duplication between Flashcard and PracticeFlashcard

`flashcard.tsx` and `practice-flashcard.tsx` share identical structure:
- Same loading skeleton pattern
- Same `revealed` state + tap-to-reveal
- Same progress bar
- Same absolute-positioned term/reading/meaning layout
- Same animation classes

Only the bottom button row differs (4 ratings vs 3 priorities). This should be a single `BaseFlashcard` component with a `renderActions` slot.

#### P1 — State: `useRef` sync pattern for stale closures

`practice/page.tsx:37-40` — Two `useRef` + `useEffect` pairs exist solely to avoid stale closures in the `setTimeout` inside `handleSetPriority`. This is a code smell. The 300ms delay should use `flushSync` + callback ref, or the advance logic should be event-driven rather than timer-driven.

#### P2 — Unused setting: `newCardOrder`

`quiz_settings.new_card_order` (`'recent' | 'priority' | 'jlpt'`) is stored and read but never consumed. `getDueWords` always delegates to `selectDueWords` which uses its own fixed scoring formula. The setting UI gives users the illusion of control over something that has no effect.

#### P2 — Duplicated utility: `getLocalDateString`

Exists in both `session-store.ts:23-29` and `date-utils.ts`. Same implementation. One should import from the other.

#### P2 — Cache invalidation timing

`supabase-repo.ts` caches `due_count` for 5 seconds. But the real issue is the 10-second `daily_stats` cache — after reviewing a card, `getDailyStats()` can return stale limits for up to 10 seconds, causing subsequent `getDueWords` calls to potentially exceed limits during rapid reviewing.

---

## 2. Language Learning Expert Perspective

### What's Working

- **FSRS is the right choice.** The ts-fsrs implementation with the 4-rating system (Again/Hard/Good/Easy) is evidence-based and well-studied. It outperforms SM-2 on retention efficiency.
- **Separation of Practice vs SRS is correct.** Practice (priority triage) and SRS (spaced repetition) serve different cognitive functions and should not be merged:
  - Practice = **sorting** (which words need more attention?)
  - SRS = **scheduling** (when should I see this word again?)
- **Auto-escalation on Again** (`quality === 0 → priority = 1`) is smart. It creates a feedback loop between SRS failure and practice priority, even though the two systems are otherwise independent.

### Serious Design Problems

#### Problem 1: Practice mode is pedagogically shallow

The current practice mode does exactly one thing: let users reassign priority (High/Normal/Low). There is no:
- **Active recall test** — the user taps to reveal, assigns priority, done. No self-assessment of whether they actually *knew* the word.
- **Retention feedback** — no data about which words were recalled correctly vs. not.
- **Typing/production practice** — receptive recognition only (see term → reveal meaning). No productive output.

Practice is currently just a **priority sorting tool disguised as a quiz**. A user who mechanically assigns "Normal" to everything gets zero learning value.

**Recommendation:** Add at least a binary self-assessment before priority assignment: "Did you know this?" (Yes/No). If No, auto-set priority to High. This creates a minimal feedback loop.

#### Problem 2: No direction control (Meaning → Term)

Both modes only test **recognition** (Term → Meaning). This is the easier direction. Language research consistently shows that **production** (Meaning → Term) is harder but produces stronger memory traces ("desirable difficulty"). There's no way to flip the card direction.

**Recommendation:** Add a quiz setting for card direction: `front → back` or `back → front` or `random`. This is a high-impact, low-effort improvement.

#### Problem 3: No context/example sentences

The flashcard shows: term, reading, meaning, notes. There's no example sentence. Isolated vocabulary learning without context has significantly lower retention than contextualized learning (Nation, 2001). Even a single example sentence dramatically improves:
- Disambiguating multiple meanings
- Encoding grammatical usage patterns
- Providing episodic memory anchors

#### Problem 4: No "Leech" detection

FSRS tracks `lapses` (number of times a card falls back to Again). Words with high lapse counts are **leeches** — cards that consume disproportionate review time without being retained. Anki flags these after 8 lapses by default. This system has no leech detection or handling strategy.

High-lapse words need intervention, not more repetition:
- Show them in a dedicated "difficult words" view
- Suggest mnemonic techniques
- Offer to break them into sub-components (kanji breakdown for Japanese)

#### Problem 5: Session size is too rigid

The general quiz fetches exactly 20 due words. QuickStart uses `newPerDay` (default 20). There's no adaptive session sizing based on:
- Available time (a user might want 5 minutes or 30 minutes)
- Card difficulty distribution (a session of all new cards is much harder than one of mostly reviews)
- Historical session completion rate

**Recommendation:** Let the user choose session size at quiz start (10/20/50/All due), or at least separate the "session size" setting from `newPerDay`.

#### Problem 6: Accuracy metric is misleading

`SessionReport` shows `accuracy = (totalReviewed - againCount) / totalReviewed`. This conflates new cards (where Again is expected) with review cards (where Again signals actual forgetting). A 70% accuracy from 15 review + 5 new cards is very different from 70% accuracy from 20 review cards.

**Recommendation:** Split into "Review accuracy" and "New card success rate", or at minimum exclude new cards from the accuracy calculation.

#### Problem 7: No interleaving in word selection

`selectDueWords` sorts purely by score (overdue-ness + priority + JLPT). This means the user encounters all high-priority overdue words first, then medium, then low. Research on interleaving (Rohrer & Taylor, 2007) shows that mixing difficulty levels and categories within a session produces better long-term retention than blocked practice.

**Recommendation:** After scoring and selecting, shuffle the final deck or apply a partial interleaving algorithm (alternate between difficulty tiers).

---

## 3. Summary Matrix

| Issue | Impact | Effort | Priority |
|-------|--------|--------|----------|
| QuickStart ignores daily limit | Bug | Low | Fix now |
| handleMaster stale state | Bug | Low | Fix now |
| No recall test in practice | Learning quality | Medium | High |
| No direction control | Learning quality | Low | High |
| Flashcard component duplication | Maintainability | Medium | Medium |
| Leech detection | Learning quality | Medium | Medium |
| No interleaving | Learning quality | Low | Medium |
| Misleading accuracy metric | UX clarity | Low | Medium |
| N+1 query pattern | Performance | Medium | Low |
| Unused `newCardOrder` setting | Dead code | Low | Low |
| Example sentences | Learning quality | High (data) | Long-term |

The two bugs (P0) should be fixed immediately. For learning quality, **direction control** is the single highest-ROI improvement — it's low effort and fundamentally changes what cognitive processes the quiz activates.
