# AI Chat — Prompt + Tool Catalog Redesign

> Status: Planning

## Motivation

The on-device Gemma 4 E2B chat assistant exhibits two production issues:

1. **Speed** — every turn ships the full 13-tool catalog (~750 tokens) regardless of context, on a default 2 KB KV cache budget. Time-to-first-token suffers proportionally.
2. **Wrong-tool selection** — observed case: from the quiz screen, user asks "문제 해설 가능할까?" (Can you explain the problem?). Model emits a `find_similar` tool call instead of answering in natural language. The screenshot shows an empty assistant bubble with a `find_similar` chip below it.

Root causes (audited against `prompts.ts`, `tools.ts`, `NivocaAiModule.swift`, `store.ts`):

- `find_similar` is a marker tool with no side effect — pure model-confusion surface (zero consumer in the codebase outside tests + i18n label).
- Tool catalog is scope-blind. Quiz context with no destructive intent still sees `delete_word`, `delete_wordbook`, `extract_words_from_image`, etc.
- Quiz scope prompt does not forbid tool calls. The phrase "Provide explanation, mnemonics, or example sentences" is ambiguous between text vs. tool emission.
- `TOKEN_BUDGET = 2048` is hardcoded. The Swift side now picks KV cache adaptively up to 32 K — the prompt code never sees the actual ceiling, so history is trimmed aggressively even on capable hardware.
- History trim drops the oldest message one at a time, which can orphan a user message from its assistant reply.
- Tool result UUIDs (36 chars) dominate `search_words` and `extract_words_from_image` payloads.

## Scope

In scope:

- Tool catalog (`apps/web/src/lib/ai/chat/tools.ts`) — `find_similar` removal, per-scope filtering, ordering, description hygiene, ID shortening.
- System prompts (`apps/web/src/lib/ai/chat/prompts.ts`) — base reinforcement, per-scope blocks for word / wordbook / quiz, rating-based tone for quiz.
- Token budget (`apps/web/src/lib/ai/chat/prompts.ts` + `NivocaAiModule.swift` + bridge) — expose `maxNumTokens` to JS, scale `TOKEN_BUDGET` and reserves dynamically, preserve user-assistant pairs on trim.
- One small consistency fix (`edit_word.priority`).
- Unit tests covering the above.
- Manual test checklist for on-device verification.

Out of scope:

- Wrong-tool telemetry (deferred — option 3 from brainstorming).
- Switching tool-result encoding to text-line format (rejected as overreach — only ID is shortened).
- LiteRT prefix cache hookup beyond making the prefix deterministic.
- Reworking the `<tool_call>` wire format.
- Cloud-fallback or model swap.

## Design

### 1. Tool catalog (`tools.ts`)

#### 1.1 Remove `find_similar`

- Delete the entry from the `TOOLS` map.
- Drop the i18n label keys in `apps/web/src/lib/i18n/{ko,en}.ts` (`tools.find_similar`) and the corresponding `types.ts` entry.
- Update `tools.test.ts` — remove the explicit `find_similar` assertions; update the "non-mutating tools" set.

#### 1.2 Scope-filtered tool sets

Add:

```ts
const SCOPE_TOOL_ALLOWLIST: Record<ChatScope['kind'], readonly string[]> = {
  general: Object.keys(TOOLS),                          // all 12
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

export function getToolDefsForBridge(scope: ChatScope): AiToolDef[] {
  const allowed = new Set(SCOPE_TOOL_ALLOWLIST[scope.kind]);
  return Object.values(TOOLS)
    .filter((t) => allowed.has(t.name))
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
```

Update the one caller in `store.ts:500`:

```ts
const tools = getToolDefsForBridge(scope);
```

`getTool(name)` stays unchanged — it must still resolve any tool the model emits (the model can ignore the allowlist and we want graceful handling).

#### 1.3 Ordering by mutation class

Reorder the `TOOLS` map declaration so iteration order is:

1. Read-only: `search_words`, `extract_words_from_image`
2. Mutating non-destructive: `add_word`, `set_mastered`, `add_word_to_wordbook`, `remove_word_from_wordbook`, `create_wordbook`, `edit_word`, `edit_wordbook`, `generate_example_sentence`
3. Destructive (last): `delete_word`, `delete_wordbook`

The bridge serializes in iteration order, so this becomes the order the model sees in `Tools: [...]`.

#### 1.4 Description hygiene

- `extract_words_from_image`: drop the `"Follow with add_word calls for words the user wants to keep."` clause. The trailing imperative biases the model into chaining `add_word` even when the user only wants a look.
- `add_word`: append `"Requires an existing dictionary entry — search via Jisho first or ask the user to provide a known dictionary form."` to the description so the model preempts the `No dictionary entry found` failure path.
- Normalize all descriptions to ~80 chars. No factual changes, just trimming filler.

#### 1.5 ID shortening

A new helper module `apps/web/src/lib/ai/chat/id-shortener.ts`:

```ts
export const ID_PREFIX_LEN = 8;

/** Truncate a UUID for inclusion in tool output. Idempotent on already-short
 *  ids — returns the input unchanged if it's already ≤ 8 chars. */
export function shortenId(id: string): string {
  return id.length <= ID_PREFIX_LEN ? id : id.slice(0, ID_PREFIX_LEN);
}
```

Resolution back to full ids is done by direct lookup against the session's `idTable` (see below). No second helper needed — the lookup is one line at the use site.

Apply in the following sites:

- `search_words.execute` — map each result's `id` through `shortenId`.
- `extract_words_from_image.execute` — extraction has no DB id yet, so no change needed (its result already has no `id` field).
- `add_word.execute` / `edit_word.execute` / `set_mastered.execute` / `create_wordbook.execute` / `edit_wordbook.execute` — return shortened id in the result payload.
- `delete_word.execute` / `delete_wordbook.execute` / `add_word_to_wordbook.execute` / `remove_word_from_wordbook.execute` — accept either full or short id by resolving against the candidate list before calling the repo.

For tools that accept a `wordId` / `wordbookId` argument, resolution happens against an in-memory **session id table** built from prior tool outputs:

```ts
// Added to ToolContext:
interface ToolContext {
  repo: DataRepository;
  locale: string;
  /** Short-id → full-id mappings the model has seen so far this session.
   *  Populated by the store as it consumes tool results. */
  idTable: { word: Map<string, string>; wordbook: Map<string, string> };
}
```

`execute` becomes:

```ts
async execute(args, { repo, idTable }) {
  const raw = str(args, 'wordId');
  const wordId = raw.length >= 36
    ? raw
    : idTable.word.get(raw) ?? null;
  if (!wordId) {
    throw new Error(
      `Unknown wordId '${raw}'. Use search_words first or paste the full id.`,
    );
  }
  // ...
}
```

The store maintains the table:

- When a tool returns shortened ids (e.g. `search_words`, `add_word`), the store walks the returned payload, calls `shortenId(full)` for every `id` it finds, and records the `(short, full)` pair in the session's `idTable`.
- When the chat session is reset (logout / `clearGeneralSession`), the table is reset too.

This design intentionally avoids a DB lookup at tool execution time. The model can only refer to ids it has been shown — anything else fails with the clear "use search_words first" message, which is also the desired model behavior.

The 8-char prefix gives ~32 bits of entropy. Two collisions within a single user's vocabulary are practically impossible at expected volumes (tens of thousands of words). On the off chance of a collision *within one session's seen-ids set* (orders of magnitude smaller), `idTable.word.get(short)` returns the most recently set value — the first inserted is shadowed. Acceptable: the model would have to specifically refer to an older id by its prefix while a newer matching one was also visible, and the failure mode (operating on the wrong word) surfaces immediately in the confirm card.

### 2. Prompts (`prompts.ts`)

#### 2.1 Base prompt

Replaces `baseSystemPrompt(locale)`:

```
You're a Japanese vocabulary tutor for a Korean learner.
Reply in Korean. ALWAYS write Japanese terms as 漢字(かな) — e.g. 桜(さくら), not just 桜 or さくら.
Use 「」 for emphasized Korean quotes, never " or ' (JSON-safe).

Tool rules:
- Never invent word/wordbook IDs. Use search_words or ask the user.
- Never call delete_* tools unless the user explicitly says "delete" or "삭제".
- For meaning/explanation/grammar/usage questions, answer in plain text. No tool call.

Example — User: "桜 뜻이 뭐야?"  You: "桜(さくら)는 「벚꽃」을 뜻해요."
Example — User: "이거 문법 설명해줘"  You: 자연어 설명만, tool 호출 없이.
```

English mode swaps the response-language sentence and the Korean example. Other lines stay identical (the tool rules are language-neutral).

#### 2.2 Quiz scope block

```
QUIZ CONTEXT — the user just rated this card as "{rating}" and is asking for help.

CURRENT CARD:
  id: {shortId}
  term: {term} ({reading}) — {meaning}
  jlpt: {jlptLevel}

Your job: explain this specific word with focus on what helps retention.
Suggest: 유의어 (synonyms), 대조어 (antonyms/contrast), 추가 예문 (more examples), 어원 or 한자 분해 (if useful).

Tone by rating:
- "again" (어려워함) → 짧고 단순한 설명, 1~2개 예문, 핵심 의미만
- "hard"           → 짧은 설명 + 비슷한 단어 1개, 예문 2개
- "good"           → 표준 설명 + 유의/대조어, 예문 2~3개
- "easy"           → nuance, 비슷한 표현 비교, 예문 3개

NO tool calls in this scope — answer entirely in natural language.
Exception: if the user explicitly asks "이 예문 저장해줘" / "마스터드 표시" / "비슷한 거 검색", use the corresponding tool.
```

The `id` field uses the shortened (8-char) form so the model sees a consistent short-id convention.

#### 2.3 Word scope block

```
WORD CONTEXT — the user is viewing this specific word.

CURRENT WORD:
  id: {shortId}
  term: {term} ({reading}) — {meaning}
  jlpt: {jlptLevel}, mastered: {bool}
  wordbooks: [{names}]

Your focus is this word and nothing else.
Suggest on request: 유의어, 대조어, 추가 예문, 사용 맥락, 어원, 비슷한 한자 단어.

When the user explicitly asks to modify (edit, add to wordbook, save example, mark mastered),
use the tool. Otherwise answer in natural language only.
```

#### 2.4 Wordbook scope block

```
WORDBOOK CONTEXT — the user is managing this wordbook.

CURRENT WORDBOOK:
  id: {shortId}
  name: {name}
  totalWords: {count}
  sample (first {N} of {total}): 
    {shortId}: {term} ({reading}) — {meaning}
    ...

You help curate this wordbook: add/remove words, rename, suggest related words.
If the user asks "이 단어장에 X 있어?", call search_words (its results auto-scope to the user's vocab).
Sample above shows {N} of {total} — call search_words for words not visible.
```

Sample size: 20 (down from 30; ~280 tokens saved).

#### 2.5 General scope

Unchanged — base prompt only, no context block.

### 3. Dynamic token budget

#### 3.1 Expose `maxNumTokens` from Swift

Three private properties to add to `NivocaAiModule` (none currently exist — verified against the file at spec time):

```swift
private var activeMaxNumTokens: Int = 0
private var activeBackend: String = "unknown"   // "gpu" | "cpu" | "unknown"
private var activeMtpEnabled: Bool = false
```

`tryCreateEngine(...)` already knows all three values (cacheSize from `pickKVCacheSize`, the backend it eventually settled on after the gpu/cpu fallback chain, and the MTP enable flag for that backend). Assign each to the corresponding property right after a successful engine creation, before returning.

Module definition adds:

```swift
AsyncFunction("getEngineInfo") { () -> [String: Any] in
  return [
    "maxNumTokens": self.activeMaxNumTokens,
    "backend": self.activeBackend,
    "mtpEnabled": self.activeMtpEnabled,
  ]
}
```

If called before the engine is loaded, `maxNumTokens` returns `0` — the JS side treats that as "unknown" and falls back to the default budget.

#### 3.2 Bridge wiring

- `apps/mobile/src/types/bridge.ts` — add `AiEngineInfo` type and the `getEngineInfo()` signature.
- `apps/web/src/lib/ai/native-bridge-adapter.ts` — `getEngineInfo()` wrapper. Cache the result for the lifetime of the JS context (engine cache size only changes on engine rebuild, which is rare).

#### 3.3 JS budget computation

In `prompts.ts`, replace the three constants:

```ts
const DEFAULT_KV_CACHE = 2048;        // fallback (web / pre-bridge)

interface Budget {
  total: number;
  reservedForOutput: number;
  reservedForNextUser: number;
}

export function getBudget(kvCache: number = DEFAULT_KV_CACHE): Budget {
  const reservedForOutput =
    kvCache >= 16384 ? 2048 :
    kvCache >= 8192  ? 1024 :
    kvCache >= 4096  ? 768  :
                       600;
  const reservedForNextUser = kvCache >= 8192 ? 400 : 200;
  return { total: kvCache, reservedForOutput, reservedForNextUser };
}
```

`trimHistoryToBudget` signature changes to accept a `Budget`:

```ts
export function trimHistoryToBudget<T extends MessageLike>(
  systemPrompt: string,
  toolsJson: string,
  messages: T[],
  budget: Budget,
): { kept: T[]; truncated: boolean };
```

Internal math becomes `budget.total - fixed - budget.reservedForOutput - budget.reservedForNextUser`.

#### 3.4 Caller wiring (`store.ts:496`)

```ts
const engineInfo = await getEngineInfo().catch(() => null);
const kvCache =
  engineInfo && engineInfo.maxNumTokens > 0 ? engineInfo.maxNumTokens : undefined;
const budget = getBudget(kvCache);
const { kept, truncated } = trimHistoryToBudget(
  systemPrompt, toolsJson, bridgeMessages, budget,
);
```

The `> 0` guard catches the pre-engine-load case where Swift returns `0`. `getBudget(undefined)` falls back to `DEFAULT_KV_CACHE`.

#### 3.5 Pair-preservation trim

`trimHistoryToBudget` walks messages in turn-groups instead of single messages:

```
group = [user] + [assistant?] + [tool*] + [assistant?]
```

Specifically: every `user` message opens a new group; everything until the next `user` belongs to that group. Drop groups (oldest first) until the remainder fits. Never split a group.

This prevents the orphan-user case where the assistant reply has been dropped but the user message stays in history, leaving the model staring at a question with no answer.

### 4. Side fixes

#### 4.1 Prefix stability (Swift)

In `buildCombinedPrompt`, serialize the tools array in alphabetical order by `name` before encoding. The JSON is otherwise unchanged. Goal: byte-for-byte identical `Tools: ...` block across turns with the same scope, so any future prefix-cache reuse in LiteRT is reachable.

#### 4.2 `edit_word.priority`

Add `priority?: number` to `edit_word`'s `parameters`. In `execute`, after the existing `repo.words.update`, if `priority !== undefined` call `repo.words.setPriority(wordId, priority)`. Matches the shape of `add_word`.

### 5. Test plan

#### 5.1 Unit tests

`apps/web/src/lib/ai/chat/tools.test.ts` (extend):

- `find_similar` absent from `TOOLS`.
- `getToolDefsForBridge({kind:'quiz'})` returns exactly 3 tools, matches the quiz allowlist.
- `getToolDefsForBridge({kind:'word'})` returns exactly 6 tools.
- `getToolDefsForBridge({kind:'wordbook'})` returns exactly 4 tools.
- `getToolDefsForBridge({kind:'general'})` returns 12 tools (all surviving entries).
- First two tools in `TOOLS` iteration are `search_words`, `extract_words_from_image`.
- Last two tools are `delete_word`, `delete_wordbook`.
- `edit_word.parameters.properties.priority` exists.

`apps/web/src/lib/ai/chat/id-shortener.test.ts` (new):

- `shortenId(uuid).length === 8` for a 36-char UUID.
- `shortenId('short')` returns `'short'` (idempotent on already-short ids).
- `shortenId('exactly8c')` returns `'exactly8'`.

`tools.test.ts` (extend) — idTable resolution:

- A mock `ToolContext` with `idTable.word = new Map([['550e8400', 'full-uuid-…']])` resolves a tool invoked with `wordId: '550e8400'`.
- Same tool invoked with an unknown short id throws an error mentioning `search_words`.
- Same tool invoked with a 36-char id bypasses the table and passes through unchanged.

`apps/web/src/lib/ai/chat/prompts.test.ts` (new):

- Base prompt (ko) contains `"漢字(かな)"`, `"Never invent word/wordbook IDs"`, `"No tool call"` (in the meaning-question rule).
- Quiz scope prompt contains `"NO tool calls"`, `"again"`, `"easy"`, `"유의어"`, `"대조어"`.
- Word scope prompt contains `"Your focus is this word and nothing else"`.
- Wordbook prompt with 25 sample words renders only 20 in `sample (first 20 of …)`.
- `getBudget(2048)` returns `{reservedForOutput:600, reservedForNextUser:200}`.
- `getBudget(8192)` returns `{reservedForOutput:1024, reservedForNextUser:400}`.
- `getBudget(32768)` returns `{reservedForOutput:2048, reservedForNextUser:400}`.
- `trimHistoryToBudget` with three user-assistant turns and a tight budget keeps the latest *complete* turn and drops the older two together (no orphan user).

#### 5.2 Manual on-device checklist

Run on the physical iPhone with the test plan in `_docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md` (this file):

1. **Quiz — natural-language only**: from quiz screen, rate a card as "again", open AI assistant, send "이거 해설해줘". Expect: prose answer with 짧고 단순한 설명, zero tool-call chips.
2. **Quiz — explicit save**: same screen, send "이 예문 저장해줘 — 桜が咲く". Expect: exactly one `generate_example_sentence` confirmation card.
3. **Word — natural-language only**: open a word's detail → AI assistant → "유의어 알려줘". Expect: prose listing synonyms, zero tool calls.
4. **Word — explicit search**: same screen, "내 단어장에 비슷한 거 있어?". Expect: one `search_words` call, then a prose summary.
5. **General — multi-tool**: assistant tab, attach an image of a vocab page, send "이 단어들 단어장에 추가해줘". Expect: `extract_words_from_image` → confirmation card listing add_word entries.
6. **High-cache history retention**: on a phone where `pickKVCacheSize` selects ≥ 8 K (Console log line `pickKVCacheSize` confirms), have 10+ turns with the assistant. Refer back to a turn ≥ 5 messages ago. Expect: the model still recalls it (no truncated state).
7. **Quiz rating tone**: rate same card "again" vs "easy" in two separate sessions, ask the same explanation question. Expect: meaningfully shorter answer for "again", richer for "easy".

#### 5.3 Regression risks

- Existing chat sessions persist tool-result JSON with full UUIDs. The model will continue to receive those in history. Both forms must resolve. The 36-char branch in `resolveShortId` covers this.
- Tools no longer in a scope's allowlist are still resolvable via `getTool(name)` if the model emits one anyway (older history might prime it). The user-confirmation gate already covers mutating tools; read-only tools execute, which is the desired forgiveness.

## Checklist

- [ ] **C1** — Remove `find_similar`. Update `tools.ts`, `tools.test.ts`, `i18n/{ko,en,types}.ts`.
- [ ] **C2** — Scope allowlist + tool ordering + description hygiene. Update `tools.ts`, `store.ts` call site.
- [ ] **C3** — ID shortener module + idTable plumbing. New `id-shortener.ts` + tests. Extend `ToolContext` with `idTable`. Apply `shortenId` to all `execute` return payloads and add the resolution branch at the top of every mutating execute that takes a `wordId` / `wordbookId`. Update `store.ts` to populate `idTable` from each tool result before passing into the next inference turn.
- [ ] **C4** — Prompt redesign. Update `prompts.ts` base + word/wordbook/quiz blocks. New `prompts.test.ts`. Wordbook sample size 30 → 20.
- [ ] **C5** — Dynamic budget + pair-preservation trim. Swift `getEngineInfo`, bridge types, JS `getBudget`, `trimHistoryToBudget` signature change, `store.ts` caller, Swift tool serialization alphabetical sort. `edit_word.priority` added (folded into this commit — touches `tools.ts` only).
- [ ] All five commits keep `bunx tsc --noEmit` and unit tests green.
- [ ] Manual checklist 1–7 run on physical iPhone after C5 lands; record observed behavior in this doc's "Implementation Notes".

## Implementation Notes

(To be filled during implementation.)

## User Feedback

(Brainstorming session 2026-05-17 — answers captured:)

- Scope: option 2 — prompts + tool catalog + history budget / KV cache dynamization (no telemetry track).
- Prompt structure: base + scope-block extension. Word/quiz scopes focus on the specific word with synonyms / antonyms / extra examples.
- Quiz/word tool surface: `generate_example_sentence`, `set_mastered`, `search_words` (Save + Search).
- ID shortening: apply (8-char prefix).
- Tool result encoding: keep current JSON, no key abbreviation, no text-line reformatting. ID shortening only.
- Wordbook sample size: 20 (chosen over 10).
- Token budget ceiling: scale to 32 K when KV cache permits, with output reserve up to 2 K at the top bucket.

## Final Summary

(To be filled after implementation + manual checklist run.)
