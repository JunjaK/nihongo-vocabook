# AI Chat Prompt + Tool Catalog Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the on-device Gemma 4 E2B chat faster and stop it from selecting the wrong tool, by rewriting the tool catalog, system prompts, and history budget.

**Architecture:** Per-scope tool allowlist drives the catalog sent to the model. Prompts split into a strong base prompt + scope-specific blocks with rating-based tone for quiz. Token budget scales with the actual KV cache that Swift picks per device. ID payloads shortened to 8-char prefixes with a per-session lookup table.

**Tech Stack:** TypeScript (apps/web), Swift (apps/mobile/modules/nivoca-ai/ios), Expo Modules bridge, Vitest 4.x, LiteRT-LM v0.11.0.

**Spec:** `_docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md`

---

## File Map

**Modified:**
- `apps/web/src/lib/ai/chat/tools.ts` — remove find_similar, add allowlist + scope-filtered export, reorder, description hygiene, idTable resolution, edit_word.priority
- `apps/web/src/lib/ai/chat/tools.test.ts` — update / extend assertions
- `apps/web/src/lib/ai/chat/prompts.ts` — base + scope blocks rewrite, dynamic budget, pair-preserving trim, getBudget helper
- `apps/web/src/lib/ai/chat/store.ts` — pass scope into `getToolDefsForBridge`, populate session idTable from tool results, wire `getEngineInfo` + new trim signature
- `apps/web/src/lib/ai/native-bridge-adapter.ts` — add `getEngineInfo()` wrapper
- `apps/web/src/lib/i18n/en.ts` / `ko.ts` / `types.ts` — drop `tools.find_similar` label
- `apps/web/src/types/chat.ts` — extend `ToolContext` with `idTable`
- `apps/mobile/src/types/bridge.ts` — `AiEngineInfo` type
- `apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift` — 3 active-state props, `getEngineInfo`, alphabetical tools sort

**Created:**
- `apps/web/src/lib/ai/chat/id-shortener.ts`
- `apps/web/src/lib/ai/chat/id-shortener.test.ts`
- `apps/web/src/lib/ai/chat/prompts.test.ts`

---

# Phase C1 — Remove `find_similar`

### Task 1: Drop find_similar from the tool catalog and i18n

**Files:**
- Modify: `apps/web/src/lib/ai/chat/tools.ts` (delete entry around line 341–359; also delete the explanatory paragraph in the module docstring referencing find_similar)
- Modify: `apps/web/src/lib/ai/chat/tools.test.ts` (remove `'find_similar'` from any expected-name lists; remove `TOOLS.find_similar.mutates` assertion)
- Modify: `apps/web/src/lib/i18n/ko.ts` — drop the `find_similar:` line under `tools:`
- Modify: `apps/web/src/lib/i18n/en.ts` — drop the `find_similar:` line under `tools:`
- Modify: `apps/web/src/lib/i18n/types.ts` — drop the `find_similar` line under `tools:`

- [ ] **Step 1: Add a failing guard test**

Append to `apps/web/src/lib/ai/chat/tools.test.ts` (inside the existing top-level `describe('TOOLS', ...)`, or as a new describe — match style of existing file):

```ts
it('does not expose find_similar — removed in 2026-05-17 redesign', () => {
  expect(Object.keys(TOOLS)).not.toContain('find_similar');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
cd apps/web && bun test src/lib/ai/chat/tools.test.ts -t 'find_similar'
```
Expected: FAIL — `Object.keys(TOOLS)` still contains `'find_similar'`.

- [ ] **Step 3: Delete `find_similar` from `tools.ts`**

In `apps/web/src/lib/ai/chat/tools.ts`:
- Delete the `find_similar: { … }` block in the `TOOLS` object (currently around lines 341–359).
- Delete the bullet `find_similar` is an acknowledgement marker…` in the module-level docstring at the top of the file.

- [ ] **Step 4: Remove all other find_similar references in tools.test.ts**

Search the file for any remaining `find_similar` (likely in expected-name arrays and a `'search_words and find_similar are non-mutating'` test). Remove each. If a test's purpose was to assert non-mutating set, rename it to `'search_words is non-mutating'` and drop the `find_similar` assertion.

- [ ] **Step 5: Remove i18n entries**

In `apps/web/src/lib/i18n/types.ts`, delete the line:
```ts
find_similar: (term: string) => string;
```
from the `tools:` block.

In `apps/web/src/lib/i18n/ko.ts`, delete:
```ts
find_similar: (term: string) => `「${term}」 유사어 추천`,
```

In `apps/web/src/lib/i18n/en.ts`, delete:
```ts
find_similar: (term: string) => `Find similar to "${term}"`,
```

- [ ] **Step 6: Run the full unit suite + typecheck**

```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bun test src/lib/ai/chat/tools.test.ts
```
Expected: TS exit 0. Tools test suite passes including the new guard.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/ai/chat/tools.ts \
        apps/web/src/lib/ai/chat/tools.test.ts \
        apps/web/src/lib/i18n/ko.ts \
        apps/web/src/lib/i18n/en.ts \
        apps/web/src/lib/i18n/types.ts
git commit -m "$(cat <<'EOF'
refactor(ai): remove find_similar marker tool

find_similar was a no-op tool that returned {acknowledged:true}. Its
only purpose was to let the model "signal" it would suggest related
words next — but Gemma 4 E2B kept picking it for unrelated questions
(observed: "문제 해설 가능?" in quiz scope triggered find_similar). Zero
non-test/non-label consumers in the codebase.

Removing it cuts the catalog from 13 → 12 tools and eliminates the
class of wrong-tool errors where the model latched onto find_similar
because it was the simplest-looking tool in the list.

Refs: _docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md C1.
EOF
)"
```

---

# Phase C2 — Scope-filtered catalog, ordering, descriptions

### Task 2: Add scope allowlist tests

**Files:**
- Modify: `apps/web/src/lib/ai/chat/tools.test.ts`

- [ ] **Step 1: Append the failing tests**

Append to `tools.test.ts`:

```ts
import type { ChatScope } from '@/types/chat';

describe('getToolDefsForBridge(scope)', () => {
  it('returns all 12 tools for general scope', () => {
    const defs = getToolDefsForBridge({ kind: 'general' });
    expect(defs).toHaveLength(12);
  });

  it('returns exactly 3 tools for quiz scope', () => {
    const defs = getToolDefsForBridge({
      kind: 'quiz',
      currentWordId: 'x',
      lastRating: 3,
    } as ChatScope);
    expect(defs.map((d) => d.name).sort()).toEqual(
      ['generate_example_sentence', 'search_words', 'set_mastered'],
    );
  });

  it('returns exactly 6 tools for word scope', () => {
    const defs = getToolDefsForBridge({ kind: 'word', wordId: 'x' });
    expect(defs.map((d) => d.name).sort()).toEqual(
      [
        'add_word_to_wordbook',
        'edit_word',
        'generate_example_sentence',
        'remove_word_from_wordbook',
        'search_words',
        'set_mastered',
      ],
    );
  });

  it('returns exactly 4 tools for wordbook scope', () => {
    const defs = getToolDefsForBridge({ kind: 'wordbook', wordbookId: 'x' });
    expect(defs.map((d) => d.name).sort()).toEqual(
      [
        'add_word_to_wordbook',
        'edit_wordbook',
        'remove_word_from_wordbook',
        'search_words',
      ],
    );
  });
});

describe('TOOLS iteration order', () => {
  it('starts with read-only tools', () => {
    const names = Object.keys(TOOLS);
    expect(names[0]).toBe('search_words');
    expect(names[1]).toBe('extract_words_from_image');
  });

  it('ends with destructive tools', () => {
    const names = Object.keys(TOOLS);
    expect(names[names.length - 2]).toBe('delete_word');
    expect(names[names.length - 1]).toBe('delete_wordbook');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd apps/web && bun test src/lib/ai/chat/tools.test.ts -t 'getToolDefsForBridge'
```
Expected: FAIL — `getToolDefsForBridge` currently takes no argument; allowlist not defined; order checks fail.

### Task 3: Implement scope allowlist + ordering

**Files:**
- Modify: `apps/web/src/lib/ai/chat/tools.ts`

- [ ] **Step 1: Add the allowlist + new signature**

Near the top of `tools.ts`, after the imports and before `export const TOOLS`:

```ts
import type { ChatScope } from '@/types/chat';

const SCOPE_TOOL_ALLOWLIST: Record<ChatScope['kind'], readonly string[]> = {
  general: [
    'search_words',
    'extract_words_from_image',
    'add_word',
    'set_mastered',
    'add_word_to_wordbook',
    'remove_word_from_wordbook',
    'create_wordbook',
    'edit_word',
    'edit_wordbook',
    'generate_example_sentence',
    'delete_word',
    'delete_wordbook',
  ],
  word: [
    'search_words',
    'set_mastered',
    'edit_word',
    'add_word_to_wordbook',
    'remove_word_from_wordbook',
    'generate_example_sentence',
  ],
  wordbook: [
    'search_words',
    'add_word_to_wordbook',
    'remove_word_from_wordbook',
    'edit_wordbook',
  ],
  quiz: [
    'search_words',
    'set_mastered',
    'generate_example_sentence',
  ],
};
```

Replace the existing `getToolDefsForBridge` (currently no argument) with the scope-aware version:

```ts
/** Tool definitions in the wire format the bridge expects (no execute fn).
 *  Filtered to the tools that are useful in the given scope. */
export function getToolDefsForBridge(scope: ChatScope): AiToolDef[] {
  const allowed = new Set(SCOPE_TOOL_ALLOWLIST[scope.kind]);
  return Object.values(TOOLS)
    .filter((t) => allowed.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
}
```

- [ ] **Step 2: Reorder the TOOLS map declaration**

Reorder the entries inside `export const TOOLS: Record<string, ToolDefinition> = { … }` to:

1. `search_words`
2. `extract_words_from_image`
3. `add_word`
4. `set_mastered`
5. `add_word_to_wordbook`
6. `remove_word_from_wordbook`
7. `create_wordbook`
8. `edit_word`
9. `edit_wordbook`
10. `generate_example_sentence`
11. `delete_word`
12. `delete_wordbook`

This is a pure move — body of each entry stays exactly the same. JavaScript object property iteration follows insertion order, so this drives the order Swift sees in the `Tools: [...]` block.

- [ ] **Step 3: Update the failing store.ts caller**

In `apps/web/src/lib/ai/chat/store.ts` around line 500, find:

```ts
const tools = getToolDefsForBridge();
```

Change to:

```ts
const tools = getToolDefsForBridge(scope);
```

`scope` is already in scope at that location (it's the `scope` parameter of the `sendMessage` closure).

- [ ] **Step 4: Run tests + typecheck**

```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bun test src/lib/ai/chat/tools.test.ts
```
Expected: TS exit 0. All scope-allowlist and ordering tests pass.

### Task 4: Description hygiene

**Files:**
- Modify: `apps/web/src/lib/ai/chat/tools.ts`

- [ ] **Step 1: Update extract_words_from_image description**

Find:
```ts
description:
  "Extract Japanese words from an image attached this turn (≤50). Follow with add_word calls for words the user wants to keep.",
```

Replace with:
```ts
description: "Extract Japanese words from an image attached this turn (≤50).",
```

The dropped clause biased the model into chaining add_word emissions even when the user only wanted to inspect.

- [ ] **Step 2: Update add_word description**

Find:
```ts
description: "Add a Japanese word to the user's list.",
```

Replace with:
```ts
description:
  "Add a Japanese word to the user's list. Requires an existing dictionary entry — search via Jisho first or ask the user for a known dictionary form.",
```

This pre-empts the `'No dictionary entry found'` runtime failure path by surfacing the constraint where the model reads it.

- [ ] **Step 3: Run tests + typecheck**

```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bun test src/lib/ai/chat/tools.test.ts
```
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/ai/chat/tools.ts \
        apps/web/src/lib/ai/chat/tools.test.ts \
        apps/web/src/lib/ai/chat/store.ts
git commit -m "$(cat <<'EOF'
refactor(ai): scope-filtered tool catalog + safer ordering + descriptions

- Add SCOPE_TOOL_ALLOWLIST mapping each chat scope to its allowed
  tool names. quiz: 3 tools, word: 6, wordbook: 4, general: all 12.
  getToolDefsForBridge(scope) filters before serialization. Cuts the
  catalog the model has to read on quiz turns by ~75%.
- Reorder TOOLS map so read-only tools come first and destructive
  delete_* tools come last. Model attention is strongest at the
  start of the catalog; safer to lead with safe tools.
- Drop the "Follow with add_word calls" trailing clause from
  extract_words_from_image — it was biasing the model into chained
  add_word emissions even when the user only wanted a look.
- Add the dictionary-entry requirement to add_word's description so
  the model preempts the 'No dictionary entry found' failure path.

Refs: _docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md C2.
EOF
)"
```

---

# Phase C3 — ID shortening + session idTable

### Task 5: Create the id-shortener module

**Files:**
- Create: `apps/web/src/lib/ai/chat/id-shortener.ts`
- Create: `apps/web/src/lib/ai/chat/id-shortener.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/ai/chat/id-shortener.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shortenId, ID_PREFIX_LEN } from './id-shortener';

describe('shortenId', () => {
  it('truncates a 36-char UUID to 8 chars', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(shortenId(uuid)).toBe('550e8400');
    expect(shortenId(uuid)).toHaveLength(8);
  });

  it('is idempotent on already-short ids', () => {
    expect(shortenId('short')).toBe('short');
  });

  it('truncates an exactly-9-char string to 8 chars', () => {
    expect(shortenId('exactly9c')).toBe('exactly9');
  });

  it('exposes ID_PREFIX_LEN === 8', () => {
    expect(ID_PREFIX_LEN).toBe(8);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd apps/web && bun test src/lib/ai/chat/id-shortener.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `apps/web/src/lib/ai/chat/id-shortener.ts`:

```ts
/**
 * UUID prefix length used in tool result payloads. 32 bits of entropy is
 * comfortably below the collision threshold for a single user's vocabulary
 * (tens of thousands of words at most).
 */
export const ID_PREFIX_LEN = 8;

/** Truncate a UUID for inclusion in tool output. Idempotent on already-short
 *  ids — returns the input unchanged if it is ≤ 8 chars. */
export function shortenId(id: string): string {
  return id.length <= ID_PREFIX_LEN ? id : id.slice(0, ID_PREFIX_LEN);
}
```

- [ ] **Step 4: Run tests**

```bash
cd apps/web && bun test src/lib/ai/chat/id-shortener.test.ts
cd apps/web && bunx tsc --noEmit
```
Expected: 4/4 pass. TS exit 0.

### Task 6: Extend `ToolContext` with `idTable`

**Files:**
- Modify: `apps/web/src/types/chat.ts` (or wherever `ToolContext` is exported — verify with `grep -rn 'interface ToolContext' apps/web/src`)
- Modify: `apps/web/src/lib/ai/chat/tools.ts` (the local `ToolContext` interface inside)

- [ ] **Step 1: Locate the canonical ToolContext**

```bash
grep -rn 'interface ToolContext' /Users/jun/develop/personal/nihongo-vocabook/apps/web/src
```

Expected: matches in `apps/web/src/lib/ai/chat/tools.ts` (line ~23). If `apps/web/src/types/chat.ts` also defines it, prefer that file. If only `tools.ts` has it, that's the source of truth.

- [ ] **Step 2: Add the idTable field**

In the file containing `interface ToolContext`, replace:

```ts
export interface ToolContext {
  repo: DataRepository;
  locale: string;
}
```

With:

```ts
export interface ChatIdTable {
  word: Map<string, string>;     // short id (8-char) → full UUID
  wordbook: Map<string, string>;
}

export interface ToolContext {
  repo: DataRepository;
  locale: string;
  /** Short-id → full-id mappings the model has seen so far this session.
   *  Populated by the store from each tool result before the next inference
   *  turn. Mutating tools that take a wordId / wordbookId resolve through
   *  this table when the arg is shorter than 36 chars. */
  idTable: ChatIdTable;
}
```

- [ ] **Step 3: Add an empty-table factory for tests + callers**

Add below the interface:

```ts
export function emptyIdTable(): ChatIdTable {
  return { word: new Map(), wordbook: new Map() };
}
```

- [ ] **Step 4: Update existing callers that construct a ToolContext**

```bash
grep -rn 'const ctx: ToolContext' /Users/jun/develop/personal/nihongo-vocabook/apps/web/src
```

Expected: one site in `store.ts` (around line 601). Update:

```ts
const ctx: ToolContext = { repo, locale };
```

to:

```ts
const ctx: ToolContext = { repo, locale, idTable: get().idTable };
```

(The store-side `idTable` is added in Task 8 — TS will fail until then. That's expected; we'll resolve in Task 8.)

- [ ] **Step 5: Typecheck — expect predictable failures from Task 8 fields**

```bash
cd apps/web && bunx tsc --noEmit 2>&1 | head -20
```
Expected: errors about `get().idTable` not existing on the store state. Continue — Task 8 adds it.

### Task 7: Apply `shortenId` + idTable resolution in execute bodies

**Files:**
- Modify: `apps/web/src/lib/ai/chat/tools.ts` — every `execute` listed below
- Modify: `apps/web/src/lib/ai/chat/tools.test.ts` — add resolution tests

- [ ] **Step 1: Add a small `resolveWordId` helper inside `tools.ts`**

Add near the existing helper functions (after `stripWordbookForToolResult` around line 88):

```ts
import { shortenId } from './id-shortener';

/** Resolve a wordId / wordbookId argument. Pass through full UUIDs; look up
 *  short prefixes in the session idTable. Throws if the model invented a
 *  prefix not seen in any tool result this session. */
function resolveId(
  raw: string,
  table: Map<string, string>,
  kind: 'wordId' | 'wordbookId',
): string {
  if (raw.length >= 36) return raw;
  const full = table.get(raw);
  if (!full) {
    throw new Error(
      `Unknown ${kind} '${raw}'. Use search_words first or paste the full id.`,
    );
  }
  return full;
}
```

- [ ] **Step 2: Write failing tests for resolution**

Append to `tools.test.ts`:

```ts
import { emptyIdTable } from './tools'; // exported in Task 6

describe('idTable resolution in execute', () => {
  const FULL_UUID = '550e8400-e29b-41d4-a716-446655440000';
  const SHORT = '550e8400';

  function ctxWith(opts: { word?: [string, string][] } = {}) {
    const idTable = emptyIdTable();
    for (const [s, f] of opts.word ?? []) idTable.word.set(s, f);
    return {
      repo: { words: { delete: async (id: string) => ({ ok: true, id }) } } as never,
      locale: 'ko',
      idTable,
    };
  }

  it('resolves a short wordId against the idTable', async () => {
    const tool = TOOLS.delete_word;
    const ctx = ctxWith({ word: [[SHORT, FULL_UUID]] });
    // We assert resolution by spying on the repo call.
    let calledWith = '';
    (ctx.repo as any).words.delete = async (id: string) => {
      calledWith = id;
      return { ok: true, id };
    };
    await tool.execute({ wordId: SHORT }, ctx);
    expect(calledWith).toBe(FULL_UUID);
  });

  it('passes a 36-char wordId through unchanged', async () => {
    const tool = TOOLS.delete_word;
    const ctx = ctxWith();
    let calledWith = '';
    (ctx.repo as any).words.delete = async (id: string) => {
      calledWith = id;
      return { ok: true, id };
    };
    await tool.execute({ wordId: FULL_UUID }, ctx);
    expect(calledWith).toBe(FULL_UUID);
  });

  it('throws a clear message when a short wordId is unknown', async () => {
    const tool = TOOLS.delete_word;
    const ctx = ctxWith();
    await expect(tool.execute({ wordId: SHORT }, ctx)).rejects.toThrow(
      /Unknown wordId.*search_words/,
    );
  });
});
```

- [ ] **Step 3: Run tests, expect failure**

```bash
cd apps/web && bun test src/lib/ai/chat/tools.test.ts -t 'idTable resolution'
```
Expected: FAIL — `execute` does not yet call `resolveId`.

- [ ] **Step 4: Update execute bodies — mutating tools that take a wordId**

For each of: `edit_word`, `delete_word`, `set_mastered`, `add_word_to_wordbook`, `remove_word_from_wordbook`, `generate_example_sentence`, the change pattern is:

Find the first line of `execute` that does:
```ts
const wordId = str(args, 'wordId');
```
or
```ts
const wordId = str(args, 'wordId');
const ...
```

Replace with:
```ts
const wordId = resolveId(str(args, 'wordId'), idTable.word, 'wordId');
```

And update the signature to destructure `idTable`:
```ts
execute: async (args, { repo, idTable }) => {
```

(For `generate_example_sentence`, the existing arg name is also `wordId`. Same pattern.)

- [ ] **Step 5: Update execute bodies — mutating tools that take a wordbookId**

For each of: `edit_wordbook`, `delete_wordbook`, `add_word_to_wordbook`, `remove_word_from_wordbook`. The pattern:

Find:
```ts
const wordbookId = str(args, 'wordbookId');
```

Replace with:
```ts
const wordbookId = resolveId(str(args, 'wordbookId'), idTable.wordbook, 'wordbookId');
```

(`add_word_to_wordbook` and `remove_word_from_wordbook` take BOTH a wordId and wordbookId — apply both replacements.)

Update each execute's destructure to include `idTable`.

- [ ] **Step 6: Apply `shortenId` to return payloads**

In `tools.ts` find:

```ts
function stripWordForToolResult(word: Word) {
  return {
    id: word.id,
    term: word.term,
    reading: word.reading,
    meaning: word.meaning,
    jlptLevel: word.jlptLevel,
  };
}

function stripWordbookForToolResult(wb: Wordbook) {
  return {
    id: wb.id,
    name: wb.name,
    description: wb.description,
  };
}
```

Replace with:

```ts
function stripWordForToolResult(word: Word) {
  return {
    id: shortenId(word.id),
    term: word.term,
    reading: word.reading,
    meaning: word.meaning,
    jlptLevel: word.jlptLevel,
  };
}

function stripWordbookForToolResult(wb: Wordbook) {
  return {
    id: shortenId(wb.id),
    name: wb.name,
    description: wb.description,
  };
}
```

For execute bodies that return ad-hoc shapes containing `wordId` / `wordbookId` (notably `delete_word`, `delete_wordbook`, `add_word_to_wordbook`, `remove_word_from_wordbook`, `set_mastered`), wrap the id in `shortenId` at the return site. Example for `delete_word`:

```ts
execute: async (args, { repo, idTable }) => {
  const wordId = resolveId(str(args, 'wordId'), idTable.word, 'wordId');
  await repo.words.delete(wordId);
  return { ok: true, wordId: shortenId(wordId) };
},
```

Do the same `shortenId` wrap in the return values of `set_mastered`, `add_word_to_wordbook`, `remove_word_from_wordbook`, `delete_wordbook`, and `generate_example_sentence`'s `id` field.

- [ ] **Step 7: Run tests**

```bash
cd apps/web && bun test src/lib/ai/chat/tools.test.ts
```
Expected: idTable resolution tests now pass. Existing tests still pass (`stripWordForToolResult` returning a shortened id doesn't break any current assertion — verify and fix any that checked full UUID).

### Task 8: Plumb the idTable through the store

**Files:**
- Modify: `apps/web/src/lib/ai/chat/store.ts`

- [ ] **Step 1: Add `idTable` to store state**

In `store.ts`, find the `ChatStoreState` interface (search for `interface ChatStoreState`). Add:

```ts
import { type ChatIdTable, emptyIdTable } from './tools';

interface ChatStoreState {
  // …existing fields…
  idTable: ChatIdTable;
}
```

And in the initial state object (the `create<ChatStoreState>((set, get) => ({` at around line 184):

```ts
idTable: emptyIdTable(),
```

- [ ] **Step 2: Reset idTable on session boundary**

Find each place that resets session state (look for `generalSession: null`). At minimum, two sites:
1. `init` (around line 195) — after the existing `set({ … hydrated: false … })` block, add `idTable: emptyIdTable()` to the reset payload.
2. `clearGeneralSession` (around line 261) — same.

Search for any other `generalSession: null` assignments and add `idTable: emptyIdTable()` next to them where it makes semantic sense (start of fresh session). `loadGeneralSession` (around line 311) and `startNewGeneralSession` (around line 318) both qualify.

- [ ] **Step 3: Populate idTable from tool results**

Search `store.ts` for `tool_result` appends — there are two paths (around line 605 inside the streaming `tool_call` branch, and around line 919 inside the confirmation-batch handler).

Both paths construct a `toolResultMsg`. Before pushing it into `sess.messages`, walk the `result` payload and harvest any id-shaped fields. Add this helper inside `store.ts` (near other top-level helpers):

```ts
function harvestIdsIntoTable(result: unknown, table: ChatIdTable, repo: DataRepository): void {
  if (!result || typeof result !== 'object') return;
  const visit = (node: unknown): void => {
    if (node && typeof node === 'object') {
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      const obj = node as Record<string, unknown>;
      // The convention from stripWordForToolResult / stripWordbookForToolResult:
      // a `term` field marks a word entity; `name` (without `term`) marks a wordbook.
      if (typeof obj.id === 'string' && obj.id.length > 0) {
        if (typeof obj.term === 'string') table.word.set(obj.id, /* full not known here */ obj.id);
        else if (typeof obj.name === 'string') table.wordbook.set(obj.id, obj.id);
      }
      if (typeof obj.wordId === 'string' && obj.wordId.length > 0) {
        table.word.set(obj.wordId, obj.wordId);
      }
      if (typeof obj.wordbookId === 'string' && obj.wordbookId.length > 0) {
        table.wordbook.set(obj.wordbookId, obj.wordbookId);
      }
      for (const v of Object.values(obj)) visit(v);
    }
  };
  visit(result);
  void repo; // reserved for future full-id lookup if needed
}
```

**Important:** the helper as written maps `short → short` because the tool result *already* contains shortened ids (Task 7 shortens at return time). To map back to a full id, we need to capture full ids before they get shortened. The cleanest fix: bypass the shortening for idTable purposes by having the store look up against the repo when the harvested id is short. But that's a DB round-trip per result.

**Decision (lock in here):** Tool execute functions also write the *full* id into the idTable on the way out. Replace the per-execute returns so that the body, alongside its return, mutates `idTable`. Specifically, after `Step 6 of Task 7`, every execute that produces an entity needs:

```ts
idTable.word.set(shortenId(word.id), word.id);
```

before returning the stripped shape. For `search_words.execute` (which returns an array) the loop sets each entry's `(shortId → fullId)` mapping before the return.

Update Task 7 mentally: in addition to wrapping ids with `shortenId` on return, also write the (short, full) pair into `idTable.word` / `idTable.wordbook` inside the execute.

This makes the store-side `harvestIdsIntoTable` unnecessary — drop it from the plan. Revert the helper code above; idTable population happens entirely inside tool executes.

So Step 3 here becomes: **NO-OP**. Skip and move to Step 4.

- [ ] **Step 4: Apply the idTable-write-on-execute change in tools.ts**

For each `execute` that returns word or wordbook entities, add the table write:

```ts
// search_words
execute: async (args, { repo, idTable }) => {
  const limit = optInt(args, 'limit', 20) ?? 10;
  const results = await repo.words.search(str(args, 'query'));
  const sliced = results.slice(0, limit);
  for (const w of sliced) idTable.word.set(shortenId(w.id), w.id);
  return sliced.map(stripWordForToolResult);
},
```

Apply the equivalent pattern to: `add_word` (the `created` entity), `edit_word` (the `updated`), `set_mastered` (set `idTable.word.set(shortenId(word.id), word.id)` if the underlying call returns a word; otherwise skip — the wordId we already have is the full UUID we used for the call), `create_wordbook`, `edit_wordbook` (and `add_word_to_wordbook` / `remove_word_from_wordbook` — these don't return entities, only confirm ok, so skip).

- [ ] **Step 5: Run tests + typecheck**

```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bun test src/lib/ai/chat/tools.test.ts src/lib/ai/chat/id-shortener.test.ts
```
Expected: TS exit 0. All tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/ai/chat/id-shortener.ts \
        apps/web/src/lib/ai/chat/id-shortener.test.ts \
        apps/web/src/lib/ai/chat/tools.ts \
        apps/web/src/lib/ai/chat/tools.test.ts \
        apps/web/src/lib/ai/chat/store.ts \
        apps/web/src/types/chat.ts
# (Only include types/chat.ts if Task 6 Step 1 located the interface there.
#  Skip it otherwise.)

git commit -m "$(cat <<'EOF'
refactor(ai): shorten ids in tool payloads + per-session idTable

- New id-shortener module exports shortenId() (UUID → 8-char prefix,
  idempotent on already-short ids).
- ToolContext gains an idTable: { word, wordbook } pair of Maps. Each
  execute that produces an entity writes (shortId, fullId) into the
  table. Each execute that accepts a wordId / wordbookId resolves
  through the table when the arg is shorter than 36 chars; passes
  36-char ids through unchanged; throws a clear "use search_words
  first" error for unknown short prefixes.
- Tool result payloads now carry 8-char ids instead of 36-char UUIDs.
  For a 20-word search result that's ~280 tokens saved off the
  conversation, and the savings compound every turn the result stays
  in history.
- Chat store owns one ChatIdTable per session; it resets on init,
  clearGeneralSession, loadGeneralSession, startNewGeneralSession.

Refs: _docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md C3.
EOF
)"
```

---

# Phase C4 — Prompt redesign

### Task 9: Write failing prompts tests

**Files:**
- Create: `apps/web/src/lib/ai/chat/prompts.test.ts`

- [ ] **Step 1: Author the test file**

Create `apps/web/src/lib/ai/chat/prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { baseSystemPrompt, buildSystemPrompt } from './prompts';
import type { Word } from '@/types/word';
import type { Wordbook } from '@/types/wordbook';
import type { DataRepository } from '@/lib/repository/types';

describe('baseSystemPrompt', () => {
  it('mentions the 漢字(かな) format requirement (ko)', () => {
    const p = baseSystemPrompt('ko');
    expect(p).toContain('漢字(かな)');
  });

  it('forbids inventing word/wordbook IDs', () => {
    const p = baseSystemPrompt('ko');
    expect(p).toContain('Never invent word/wordbook IDs');
  });

  it('directs plain-text answers for meaning questions', () => {
    const p = baseSystemPrompt('ko');
    expect(p.toLowerCase()).toContain('no tool call');
  });

  it('English variant exists and uses English example sentence', () => {
    const p = baseSystemPrompt('en');
    expect(p).toContain('Reply in English');
  });
});

function fakeWord(): Word {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    dictionaryEntryId: 'd',
    term: '桜',
    reading: 'さくら',
    meaning: '벚꽃',
    jlptLevel: 5,
    mastered: false,
    notes: null,
    tags: [],
    priority: 0,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Word;
}

function fakeRepo(words: Word[] = [], wordbook?: Wordbook): DataRepository {
  return {
    words: {
      getById: async (id: string) => words.find((w) => w.id === id) ?? null,
      // …only the methods buildSystemPrompt touches…
    } as never,
    wordbooks: {
      getAll: async () => (wordbook ? [wordbook] : []),
      getWordbooksForWord: async () => (wordbook ? [wordbook] : []),
      getWordsPaginated: async () => ({ words, totalCount: words.length }),
    } as never,
    chat: {} as never,
    study: {} as never,
    exportAll: (async () => ({}) ) as never,
  } as unknown as DataRepository;
}

describe('buildSystemPrompt — quiz scope', () => {
  it('contains the rating-tone block with all four ratings', async () => {
    const word = fakeWord();
    const p = await buildSystemPrompt(
      { kind: 'quiz', currentWordId: word.id, lastRating: 1 },
      fakeRepo([word]),
      'ko',
    );
    expect(p).toMatch(/again/i);
    expect(p).toMatch(/hard/i);
    expect(p).toMatch(/good/i);
    expect(p).toMatch(/easy/i);
  });

  it('forbids tool calls in quiz scope', async () => {
    const word = fakeWord();
    const p = await buildSystemPrompt(
      { kind: 'quiz', currentWordId: word.id, lastRating: 3 },
      fakeRepo([word]),
      'ko',
    );
    expect(p).toContain('NO tool calls');
  });

  it('uses the shortened id in the card line', async () => {
    const word = fakeWord();
    const p = await buildSystemPrompt(
      { kind: 'quiz', currentWordId: word.id, lastRating: 3 },
      fakeRepo([word]),
      'ko',
    );
    expect(p).toContain('id: 550e8400');
    expect(p).not.toContain(word.id); // full UUID should not appear
  });
});

describe('buildSystemPrompt — word scope', () => {
  it('focuses on the single word', async () => {
    const word = fakeWord();
    const p = await buildSystemPrompt(
      { kind: 'word', wordId: word.id },
      fakeRepo([word]),
      'ko',
    );
    expect(p).toContain('Your focus is this word and nothing else');
  });
});

describe('buildSystemPrompt — wordbook scope', () => {
  it('caps the sample at 20 words', async () => {
    const words: Word[] = Array.from({ length: 25 }, (_, i) => ({
      ...fakeWord(),
      id: `id-${i}`.padEnd(36, '0'),
      term: `単語${i}`,
    }));
    const wb: Wordbook = {
      id: 'wb-1234'.padEnd(36, '0'),
      name: 'JLPT N3',
      description: null,
      createdAt: 0,
      updatedAt: 0,
    } as unknown as Wordbook;
    const p = await buildSystemPrompt(
      { kind: 'wordbook', wordbookId: wb.id },
      fakeRepo(words, wb),
      'ko',
    );
    // The sample line says "first 20 of {total}". 25 → 20.
    expect(p).toContain('sample (first 20 of 25)');
    // The 21st through 25th words must not appear.
    expect(p).not.toContain('単語24');
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

```bash
cd apps/web && bun test src/lib/ai/chat/prompts.test.ts
```
Expected: FAIL — current prompts don't match the new strings.

### Task 10: Rewrite the base prompt

**Files:**
- Modify: `apps/web/src/lib/ai/chat/prompts.ts`

- [ ] **Step 1: Replace `baseSystemPrompt`**

Find the current `baseSystemPrompt` (lines 17–34). Replace with:

```ts
export function baseSystemPrompt(locale: string): string {
  const isKo = locale === 'ko';
  const replyLine = isKo
    ? 'Reply in Korean.'
    : 'Reply in English.';
  const exampleLine = isKo
    ? 'Example — User: "桜 뜻이 뭐야?"  You: "桜(さくら)는 「벚꽃」을 뜻해요."'
    : 'Example — User: "What does 桜 mean?"  You: "桜(さくら) means cherry blossom."';
  const grammarExample = isKo
    ? 'Example — User: "이거 문법 설명해줘"  You: 자연어 설명만, tool 호출 없이.'
    : 'Example — User: "Explain the grammar."  You: Plain-text explanation, no tool call.';

  return [
    "You're a Japanese vocabulary tutor for a Korean learner.",
    `${replyLine} ALWAYS write Japanese terms as 漢字(かな) — e.g. 桜(さくら), not just 桜 or さくら.`,
    'Use 「」 for emphasized Korean quotes, never " or \' (JSON-safe).',
    '',
    'Tool rules:',
    '- Never invent word/wordbook IDs. Use search_words or ask the user.',
    '- Never call delete_* tools unless the user explicitly says "delete" or "삭제".',
    '- For meaning/explanation/grammar/usage questions, answer in plain text. No tool call.',
    '',
    exampleLine,
    grammarExample,
  ].join('\n');
}
```

- [ ] **Step 2: Run base-prompt tests, confirm they pass**

```bash
cd apps/web && bun test src/lib/ai/chat/prompts.test.ts -t 'baseSystemPrompt'
```
Expected: 4/4 pass.

### Task 11: Rewrite the quiz context block

**Files:**
- Modify: `apps/web/src/lib/ai/chat/prompts.ts`

- [ ] **Step 1: Add `shortenId` import + replace `quizContextBlock`**

Add at the top of `prompts.ts` (with existing imports):

```ts
import { shortenId } from './id-shortener';
```

Find the current `quizContextBlock` (lines 74–103). Replace with:

```ts
function quizContextBlock(
  word: Word | null,
  lastRating: number | undefined,
): string {
  if (!word) {
    return [
      '',
      'QUIZ CONTEXT — no card visible (the session may have ended).',
    ].join('\n');
  }
  const ratingMap: Record<number, string> = {
    1: 'again',
    2: 'hard',
    3: 'good',
    4: 'easy',
  };
  const rating =
    lastRating !== undefined ? (ratingMap[lastRating] ?? `unknown(${lastRating})`) : 'unknown';
  return [
    '',
    `QUIZ CONTEXT — the user just rated this card as "${rating}" and is asking for help.`,
    '',
    'CURRENT CARD:',
    `  id: ${shortenId(word.id)}`,
    `  term: ${word.term} (${word.reading}) — ${word.meaning}`,
    `  jlpt: ${word.jlptLevel ?? 'unknown'}`,
    '',
    'Your job: explain this specific word with focus on what helps retention.',
    'Suggest: 유의어 (synonyms), 대조어 (antonyms/contrast), 추가 예문 (more examples), 어원 or 한자 분해 (if useful).',
    '',
    'Tone by rating:',
    '- "again" (어려워함) → 짧고 단순한 설명, 1~2개 예문, 핵심 의미만',
    '- "hard"           → 짧은 설명 + 비슷한 단어 1개, 예문 2개',
    '- "good"           → 표준 설명 + 유의/대조어, 예문 2~3개',
    '- "easy"           → nuance, 비슷한 표현 비교, 예문 3개',
    '',
    'NO tool calls in this scope — answer entirely in natural language.',
    'Exception: if the user explicitly asks "이 예문 저장해줘" / "마스터드 표시" / "비슷한 거 검색", use the corresponding tool.',
  ].join('\n');
}
```

- [ ] **Step 2: Run quiz tests**

```bash
cd apps/web && bun test src/lib/ai/chat/prompts.test.ts -t 'quiz'
```
Expected: 3/3 pass.

### Task 12: Rewrite word and wordbook context blocks

**Files:**
- Modify: `apps/web/src/lib/ai/chat/prompts.ts`

- [ ] **Step 1: Replace `wordContextBlock`**

Find the current `wordContextBlock` (lines 36–50). Replace with:

```ts
function wordContextBlock(word: Word, wordbooks: WordbookWithCount[]): string {
  const wbNames = wordbooks.length > 0 ? wordbooks.map((w) => w.name).join(', ') : '(none)';
  return [
    '',
    'WORD CONTEXT — the user is viewing this specific word.',
    '',
    'CURRENT WORD:',
    `  id: ${shortenId(word.id)}`,
    `  term: ${word.term} (${word.reading}) — ${word.meaning}`,
    `  jlpt: ${word.jlptLevel ?? 'unknown'}, mastered: ${word.mastered ? 'true' : 'false'}`,
    `  wordbooks: [${wbNames}]`,
    '',
    'Your focus is this word and nothing else.',
    'Suggest on request: 유의어, 대조어, 추가 예문, 사용 맥락, 어원, 비슷한 한자 단어.',
    '',
    'When the user explicitly asks to modify (edit, add to wordbook, save example, mark mastered),',
    'use the tool. Otherwise answer in natural language only.',
  ].join('\n');
}
```

- [ ] **Step 2: Replace `wordbookContextBlock` and bump sample size**

Find the current `MAX_WORDBOOK_SAMPLE = 30` constant near the top of `prompts.ts` and change to:

```ts
const MAX_WORDBOOK_SAMPLE = 20;
```

Find the current `wordbookContextBlock` (lines 52–72). Replace with:

```ts
function wordbookContextBlock(
  wb: WordbookWithCount,
  sample: Word[],
): string {
  const sampleLines = sample
    .slice(0, MAX_WORDBOOK_SAMPLE)
    .map((w) => `    ${shortenId(w.id)}: ${w.term} (${w.reading}) — ${w.meaning}`)
    .join('\n');
  const shown = Math.min(sample.length, MAX_WORDBOOK_SAMPLE);
  return [
    '',
    'WORDBOOK CONTEXT — the user is managing this wordbook.',
    '',
    'CURRENT WORDBOOK:',
    `  id: ${shortenId(wb.id)}`,
    `  name: ${wb.name}`,
    `  totalWords: ${wb.wordCount}`,
    `  sample (first ${shown} of ${wb.wordCount}):`,
    sampleLines || '    (no words)',
    '',
    'You help curate this wordbook: add/remove words, rename, suggest related words.',
    'If the user asks "이 단어장에 X 있어?", call search_words (its results auto-scope to the user\'s vocab).',
    `Sample above shows ${shown} of ${wb.wordCount} — call search_words for words not visible.`,
  ].join('\n');
}
```

- [ ] **Step 3: Verify `buildSystemPrompt`'s wordbook branch uses the new limit**

The branch currently passes `limit: MAX_WORDBOOK_SAMPLE` to `getWordsPaginated`. With the constant now at 20, this becomes 20 automatically. Verify by reading the branch (around line 130 of `prompts.ts`) — no code change needed if the constant is shared.

- [ ] **Step 4: Run all prompt tests + typecheck**

```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bun test src/lib/ai/chat/prompts.test.ts
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/ai/chat/prompts.ts \
        apps/web/src/lib/ai/chat/prompts.test.ts
git commit -m "$(cat <<'EOF'
refactor(ai): redesign system prompts with scope-specific tone

Base prompt rewritten with explicit 漢字(かな) format requirement, a
clearer Tool-rules block, and a second example covering grammar/
explain questions (the screenshot bug — "문제 해설 가능?" was the
trigger). The persona shifts from a generic "Japanese vocabulary
assistant" to a "Japanese vocabulary tutor for a Korean learner",
which biases the model toward the explanatory register the app
actually wants.

Quiz scope block adds:
- Rating-keyed tone guidance (again → simplest, easy → richest)
  so the same explanation question scales with the user's signal.
- An explicit "NO tool calls" directive plus a narrowly-scoped
  exception for save/master/search intents. This is what closes
  the find_similar-on-quiz-screen failure mode.
- Shortened (8-char) ids in the card line, matching the
  convention now used in tool result payloads (C3).

Word scope block tightens to "your focus is this word and nothing
else" with a content menu (synonyms, antonyms, etymology, kanji
breakdown). Wordbook scope sample cap is 30 → 20, also a token
budget win (~280 tokens off a wordbook turn).

Refs: _docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md C4.
EOF
)"
```

---

# Phase C5 — Dynamic budget + Swift expose + pair-preservation trim

### Task 13: Swift — expose engine info

**Files:**
- Modify: `apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift`

- [ ] **Step 1: Add the three properties**

Locate the existing private property block near the top of the `NivocaAiModule` class (search for `private var engine: OpaquePointer? = nil`). Append below it:

```swift
private var activeMaxNumTokens: Int = 0
private var activeBackend: String = "unknown"   // "gpu" | "cpu" | "unknown"
private var activeMtpEnabled: Bool = false
```

- [ ] **Step 2: Assign the values inside `tryCreateEngine`**

Find `tryCreateEngine` (search for `private func tryCreateEngine`). Inside it, right after `let cacheSize = pickKVCacheSize()`, add:

```swift
self.activeMaxNumTokens = cacheSize
```

At each `return true` point in the fallback chain (gpu+MTP success, gpu success, cpu+MTP success, cpu success — there are typically four), set `activeBackend` and `activeMtpEnabled` to the values that matched the branch. Example for the gpu+MTP branch:

```swift
self.activeBackend = "gpu"
self.activeMtpEnabled = true
return true
```

For cpu branches set `"cpu"`; for non-MTP branches set `false`. Match the exact branch identity used in the existing log messages — those log lines tell you which branch you're in.

- [ ] **Step 3: Reset on engine teardown**

Find `teardownEngine` (search `private func teardownEngine`). At the end of the method, add:

```swift
self.activeMaxNumTokens = 0
self.activeBackend = "unknown"
self.activeMtpEnabled = false
```

- [ ] **Step 4: Add the AsyncFunction**

In `definition()` (the Module DSL block), alongside the other `AsyncFunction(...)` entries, add:

```swift
AsyncFunction("getEngineInfo") { () -> [String: Any] in
  return [
    "maxNumTokens": self.activeMaxNumTokens,
    "backend": self.activeBackend,
    "mtpEnabled": self.activeMtpEnabled,
  ]
}
```

- [ ] **Step 5: Alphabetical sort of the tools array (prefix stability)**

Find `buildCombinedPrompt` (search `private func buildCombinedPrompt`). At the line:

```swift
var toolsArr: [[String: Any]] = []
for tool in tools {
```

Replace with:

```swift
var toolsArr: [[String: Any]] = []
for tool in tools.sorted(by: { $0.name < $1.name }) {
```

This makes the serialized `Tools: ...` JSON byte-for-byte identical across turns with the same scope.

- [ ] **Step 6: Verify the Swift module builds**

```bash
cd /Users/jun/develop/personal/nihongo-vocabook/apps/mobile \
  && bunx expo prebuild --platform ios --clean
```

Expected: prebuild succeeds. Full device build happens at the end of Task 17.

### Task 14: Bridge type + JS wrapper

**Files:**
- Modify: `apps/mobile/src/types/bridge.ts`
- Modify: `apps/web/src/lib/ai/native-bridge-adapter.ts`

- [ ] **Step 1: Add the wire type**

In `apps/mobile/src/types/bridge.ts`, add:

```ts
export interface AiEngineInfo {
  maxNumTokens: number;
  backend: 'gpu' | 'cpu' | 'unknown';
  mtpEnabled: boolean;
}
```

- [ ] **Step 2: Add the JS wrapper**

In `apps/web/src/lib/ai/native-bridge-adapter.ts`, add a new exported function. Match the existing wrappers in the file for style (they probably use `NivocaAi.getXxx()` via the expo modules host). Example:

```ts
import type { AiEngineInfo } from '@/types/bridge';

let cachedEngineInfo: AiEngineInfo | null = null;

export async function getEngineInfo(): Promise<AiEngineInfo> {
  if (cachedEngineInfo) return cachedEngineInfo;
  if (!isNativeApp()) {
    return { maxNumTokens: 0, backend: 'unknown', mtpEnabled: false };
  }
  // Replace `NivocaAi` with the actual import name used elsewhere in this file.
  const info = (await NivocaAi.getEngineInfo()) as AiEngineInfo;
  cachedEngineInfo = info;
  return info;
}

export function resetEngineInfoCache(): void {
  cachedEngineInfo = null;
}
```

Note: the path `'@/types/bridge'` resolves to the mobile-side type. In the web app, alias setup may differ — if the existing native bridge adapter file already has comparable types declared inline, declare `AiEngineInfo` inline here too instead of importing across the workspace boundary.

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```
Expected: exit 0.

### Task 15: getBudget + trimHistoryToBudget rewrite (with pair preservation)

**Files:**
- Modify: `apps/web/src/lib/ai/chat/prompts.ts`
- Modify: `apps/web/src/lib/ai/chat/prompts.test.ts`

- [ ] **Step 1: Write the failing budget + trim tests**

Append to `prompts.test.ts`:

```ts
import { getBudget, trimHistoryToBudget } from './prompts';

describe('getBudget', () => {
  it('returns conservative reserves on the 2K bucket', () => {
    expect(getBudget(2048)).toEqual({
      total: 2048,
      reservedForOutput: 600,
      reservedForNextUser: 200,
    });
  });

  it('scales output reserve to 1024 on the 8K bucket', () => {
    expect(getBudget(8192)).toEqual({
      total: 8192,
      reservedForOutput: 1024,
      reservedForNextUser: 400,
    });
  });

  it('caps output reserve at 2048 on the 32K bucket', () => {
    expect(getBudget(32768)).toEqual({
      total: 32768,
      reservedForOutput: 2048,
      reservedForNextUser: 400,
    });
  });

  it('falls back to the 2K bucket on undefined input', () => {
    expect(getBudget(undefined)).toEqual({
      total: 2048,
      reservedForOutput: 600,
      reservedForNextUser: 200,
    });
  });
});

describe('trimHistoryToBudget — pair preservation', () => {
  // Helper: a message of `chars` text characters in the text block.
  function msg(role: 'user' | 'assistant' | 'tool', chars: number) {
    return {
      role,
      content: [{ type: 'text' as const, text: 'x'.repeat(chars) }],
    };
  }

  it('drops in turn groups, never orphans a user from its assistant', () => {
    const history = [
      msg('user', 400),
      msg('assistant', 400),
      msg('user', 400),
      msg('assistant', 400),
      msg('user', 400),
      msg('assistant', 400),
    ];
    // Budget tight enough to drop one full turn (2 messages × ~100 tokens
    // each = ~200; available ~ 400 → keep last 2 turns only).
    const budget = { total: 2048, reservedForOutput: 600, reservedForNextUser: 200 };
    const { kept, truncated } = trimHistoryToBudget(
      /* system */ 'x'.repeat(200 * 4),
      /* toolsJson */ '[]',
      history,
      budget,
    );
    expect(truncated).toBe(true);
    // kept length must be even — pairs only.
    expect(kept.length % 2).toBe(0);
    // First kept message must be a user role (the start of a turn).
    expect(kept[0].role).toBe('user');
  });

  it('keeps everything when the budget is large enough', () => {
    const history = [msg('user', 50), msg('assistant', 50)];
    const budget = { total: 32768, reservedForOutput: 2048, reservedForNextUser: 400 };
    const { kept, truncated } = trimHistoryToBudget('x', '[]', history, budget);
    expect(truncated).toBe(false);
    expect(kept).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd apps/web && bun test src/lib/ai/chat/prompts.test.ts -t 'getBudget|trim'
```
Expected: FAIL — `getBudget` not exported; `trimHistoryToBudget` has the old signature.

- [ ] **Step 3: Replace the budget block in `prompts.ts`**

Find the existing budget section (search for `const TOKEN_BUDGET = 2048;`). Replace the block from `const TOKEN_BUDGET = 2048;` down to the end of `trimHistoryToBudget` with:

```ts
const DEFAULT_KV_CACHE = 2048;
const IMAGE_TOKEN_COST = 256;
const AUDIO_TOKEN_COST = 384;

export interface Budget {
  total: number;
  reservedForOutput: number;
  reservedForNextUser: number;
}

/**
 * Pick reasonable reserves for the given KV cache ceiling. Bigger caches
 * support richer explanations without truncating mid-sentence, so the output
 * reserve scales up; the next-user reserve grows modestly for multi-turn
 * quiz Q&A.
 */
export function getBudget(kvCache?: number): Budget {
  const total = kvCache && kvCache > 0 ? kvCache : DEFAULT_KV_CACHE;
  const reservedForOutput =
    total >= 16384 ? 2048 :
    total >= 8192  ? 1024 :
    total >= 4096  ? 768  :
                     600;
  const reservedForNextUser = total >= 8192 ? 400 : 200;
  return { total, reservedForOutput, reservedForNextUser };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface MessageLike {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; attachmentId?: string; source?: string }
    | { type: 'audio'; attachmentId?: string; source?: string; mimeType?: string }
    | { type: 'tool_result'; result: unknown }
  >;
}

export function estimateMessageTokens(msg: MessageLike): number {
  let total = 4; // role tags overhead
  for (const block of msg.content) {
    if (block.type === 'text') total += estimateTokens(block.text);
    else if (block.type === 'image') total += IMAGE_TOKEN_COST;
    else if (block.type === 'audio') total += AUDIO_TOKEN_COST;
    else if (block.type === 'tool_result') total += estimateTokens(JSON.stringify(block.result ?? {}));
  }
  return total;
}

/**
 * Group consecutive messages into turn groups. A new group starts on each
 * `user` message; everything until the next `user` (assistant replies,
 * tool results, follow-up assistant chunks) belongs to that group.
 */
function groupTurns<T extends MessageLike>(messages: T[]): T[][] {
  const groups: T[][] = [];
  for (const m of messages) {
    if (m.role === 'user' || groups.length === 0) {
      groups.push([m]);
    } else {
      groups[groups.length - 1].push(m);
    }
  }
  return groups;
}

/**
 * Trim oldest history turn-groups until the system + tools + remaining history
 * fits within the budget. Returns kept messages (flattened) plus whether any
 * truncation occurred.
 *
 * Turn groups are atomic — never split. This prevents the orphan-user case
 * where the assistant reply was dropped but the user message remained,
 * leaving the model staring at a question with no answer.
 */
export function trimHistoryToBudget<T extends MessageLike>(
  systemPrompt: string,
  toolsJson: string,
  messages: T[],
  budget: Budget,
): { kept: T[]; truncated: boolean } {
  const fixed = estimateTokens(systemPrompt) + estimateTokens(toolsJson);
  const available = budget.total - fixed - budget.reservedForOutput - budget.reservedForNextUser;

  const groups = groupTurns(messages);
  const keptGroups: T[][] = [];
  let used = 0;
  let truncated = false;

  for (let i = groups.length - 1; i >= 0; i--) {
    const cost = groups[i].reduce((acc, m) => acc + estimateMessageTokens(m), 0);
    if (used + cost > available) {
      truncated = true;
      break;
    }
    keptGroups.unshift(groups[i]);
    used += cost;
  }
  return { kept: keptGroups.flat(), truncated };
}
```

This subsumes the old `TOKEN_BUDGET` / `RESERVED_FOR_OUTPUT` / `RESERVED_FOR_NEXT_USER` constants and old `trimHistoryToBudget`. Delete the old constants. `estimateTokens` and `estimateMessageTokens` are re-declared (the constants and helpers are moved into the new block — make sure not to duplicate them by leaving the old declarations in place).

- [ ] **Step 4: Run prompts tests**

```bash
cd apps/web && bun test src/lib/ai/chat/prompts.test.ts
```
Expected: all green (12+ tests).

### Task 16: Wire the new budget in `store.ts`

**Files:**
- Modify: `apps/web/src/lib/ai/chat/store.ts`

- [ ] **Step 1: Update imports and the trim call**

Near the top of `store.ts`, ensure the imports include:

```ts
import {
  buildSystemPrompt,
  trimHistoryToBudget,
  getBudget,
} from './prompts';
import { getEngineInfo } from '@/lib/ai/native-bridge-adapter';
```

Around line 496 of `store.ts`, the current code is:

```ts
const { kept, truncated } = trimHistoryToBudget(systemPrompt, toolsJson, bridgeMessages);
```

Replace with:

```ts
const engineInfo = await getEngineInfo().catch(() => null);
const kvCache =
  engineInfo && engineInfo.maxNumTokens > 0 ? engineInfo.maxNumTokens : undefined;
const budget = getBudget(kvCache);
const { kept, truncated } = trimHistoryToBudget(
  systemPrompt,
  toolsJson,
  bridgeMessages,
  budget,
);
```

- [ ] **Step 2: Add a recordMetric line so this is observable**

Right after the `trimHistoryToBudget` call, before any other action with `kept`:

```ts
void recordMetric('chat.budget', {
  scope: scope.kind,
  kvCache: budget.total,
  truncated,
  kept: kept.length,
});
```

(If `recordMetric` is already used in the surrounding code with a different metric name convention, match it.)

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```
Expected: exit 0.

### Task 17: edit_word.priority + final commit + manual verification

**Files:**
- Modify: `apps/web/src/lib/ai/chat/tools.ts`
- Modify: `apps/web/src/lib/ai/chat/tools.test.ts`

- [ ] **Step 1: Write the failing schema test**

Append to `tools.test.ts`:

```ts
describe('edit_word.priority', () => {
  it('declares priority in its parameter schema', () => {
    const params = TOOLS.edit_word.parameters as {
      properties: Record<string, unknown>;
    };
    expect(params.properties.priority).toBeDefined();
  });
});
```

```bash
cd apps/web && bun test src/lib/ai/chat/tools.test.ts -t 'edit_word.priority'
```
Expected: FAIL.

- [ ] **Step 2: Add the field**

In `tools.ts`, find the `edit_word` entry. In its `parameters.properties`, add:

```ts
priority: { type: 'integer', minimum: 0, maximum: 5 },
```

Adjacent to the existing `jlptLevel` line.

In its `execute` body, after the existing `repo.words.update(...)`, add:

```ts
const priority = optInt(args, 'priority');
if (priority !== undefined) {
  await repo.words.setPriority(updated.id, priority);
}
```

- [ ] **Step 3: Run all unit tests + typecheck**

```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bun test
```
Expected: full suite green.

- [ ] **Step 4: Commit the C5 bundle**

```bash
git add apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift \
        apps/mobile/src/types/bridge.ts \
        apps/web/src/lib/ai/native-bridge-adapter.ts \
        apps/web/src/lib/ai/chat/prompts.ts \
        apps/web/src/lib/ai/chat/prompts.test.ts \
        apps/web/src/lib/ai/chat/store.ts \
        apps/web/src/lib/ai/chat/tools.ts \
        apps/web/src/lib/ai/chat/tools.test.ts
git commit -m "$(cat <<'EOF'
feat(ai): dynamic token budget + pair-preserving trim + Swift expose

- Swift module tracks the active KV cache size (chosen by
  pickKVCacheSize), backend, and MTP flag, and exposes them as
  getEngineInfo() to JS. Tools array is now serialized in
  alphabetical order so the prefix sent to the model is identical
  across turns at the same scope (a precondition for any future
  prefix-cache reuse in LiteRT).
- JS getBudget(kvCache) replaces the hardcoded TOKEN_BUDGET = 2048.
  Buckets: 2K/4K/8K/16K+ each pick output reserve 600/768/1024/2048
  and next-user reserve 200/200/400/400. On a 32 K cache that means
  ~28 K of history budget — practically the whole conversation
  stays in context.
- trimHistoryToBudget now groups messages into turn groups (a user
  message + everything until the next user message) and drops by
  group. No more orphan-user case where the assistant reply got
  trimmed but the question remained.
- edit_word gains a priority parameter, matching add_word's shape.
  Closes a consistency hole the model would otherwise hit when
  asked to "change this word's priority to 3".

Refs: _docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md C5.
EOF
)"
```

- [ ] **Step 5: Rebuild and install on device**

```bash
cd /Users/jun/develop/personal/nihongo-vocabook/apps/mobile \
  && bunx expo run:ios --device 00008130-0010356C2411401C
```

Expected: build succeeds, install succeeds, app launches (unlock the phone first if locked).

- [ ] **Step 6: Run the manual checklist (record results in the spec)**

In `_docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md` "Implementation Notes" section, append a "Manual verification (YYYY-MM-DD)" subsection. For each scenario, write **PASS** / **FAIL** with one-line observation.

1. **Quiz — natural-language only**: quiz screen → rate "again" → AI assistant → "이거 해설해줘". Expect prose answer with 짧고 단순한 설명, zero tool-call chips.
2. **Quiz — explicit save**: same screen, "이 예문 저장해줘 — 桜が咲く". Expect one `generate_example_sentence` confirmation card.
3. **Word — natural-language only**: word detail → AI assistant → "유의어 알려줘". Expect prose listing, zero tool calls.
4. **Word — explicit search**: "내 단어장에 비슷한 거 있어?". Expect one `search_words` call, then a prose summary.
5. **General — multi-tool**: assistant tab, attach a vocab-page image, send "이 단어들 단어장에 추가해줘". Expect `extract_words_from_image` → confirmation card.
6. **High-cache history retention**: on a phone where `pickKVCacheSize` ≥ 8 K (Console log confirms), have 10+ turns. Refer back to a turn ≥ 5 messages ago. Expect the model still recalls.
7. **Quiz rating tone**: same card rated "again" vs "easy" in two separate sessions, same question. Expect noticeably shorter answer for "again", richer for "easy".

- [ ] **Step 7: Mark plan + spec complete**

If all 7 scenarios pass:
- In the spec ("Final Summary" section), write a 1-paragraph close-out describing what shipped and any deviations from the design.
- Move both files: `git mv _docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md _docs/complete/` and `git mv _docs/active/2026-05-17-ai-chat-prompt-tool-redesign-plan.md _docs/complete/`.
- Commit the move with `docs(ai): complete prompt+tool redesign — all manual scenarios pass`.

If any scenario fails: update "Implementation Notes" with the failure, decide whether to file a follow-up commit or revise the design, and leave both docs in `_docs/active/` for the follow-up cycle.

---

## Self-review notes

Spec coverage:
- C1 find_similar removal → Task 1 ✓
- C2 scope allowlist + ordering + descriptions → Tasks 2–4 ✓
- C3 ID shortening + idTable → Tasks 5–8 ✓
- C4 prompt redesign → Tasks 9–12 ✓
- C5 dynamic budget + Swift + edit_word.priority → Tasks 13–17 ✓
- Manual checklist (spec §5.2) → Task 17 Step 6 ✓
- Regression risks (spec §5.3) → addressed by `resolveId`'s 36-char passthrough and `getTool` (unchanged) ✓

Type consistency:
- `getToolDefsForBridge(scope)` signature used in Task 3 matches the call site update in Task 3 Step 3 ✓
- `resolveId(raw, table, kind)` introduced in Task 7 Step 1 is used in subsequent steps with matching arg order ✓
- `Budget` type fields (`total`, `reservedForOutput`, `reservedForNextUser`) used consistently across `getBudget`, `trimHistoryToBudget`, store wiring ✓
- `ChatIdTable` / `emptyIdTable` exported from `tools.ts` (Task 6) and imported in `store.ts` (Task 8) ✓
- `AiEngineInfo` fields match across Swift (`maxNumTokens`, `backend`, `mtpEnabled`) and TS ✓
