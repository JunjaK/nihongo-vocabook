# AI Assistant + Footer Redesign

> Status: **Planning** — design approved, awaiting implementation plan
> Date: 2026-05-14
> Related: [blog-gemma4-ios-litert-journey.md](./blog-gemma4-ios-litert-journey.md)

## Summary

Add on-device AI chat (general + per-word/wordbook/quiz context) with function
calling for CRUD on words and wordbooks. Reuse the existing Gemma 4 E2B
LiteRT-LM stack that powers OCR. Reorganize the footer: drop the `Mastered`
tab, promote `Assistant` into the center slot, and present the
active/mastered split via a segmented toggle that animates between the
existing `/words` and `/mastered` routes.

All inference stays on-device (iOS only, paid Apple Developer entitlement
required). Mutating tool calls always require user confirmation via a
multi-select card. Inference runs as a background-tracked store at the app
shell so navigation away from the chat does not interrupt generation.

## Decisions Log

| # | Decision | Rationale |
|---|---|---|
| D1 | Single-model architecture: Gemma 4 E2B for OCR + chat + function calling | User preference for a single model family; avoids adding FunctionGemma 270m (Gemma 3 lineage) |
| D2 | Mutating tool calls always require user confirmation | Data safety > friction; reversibility of LLM-driven mutations cannot be guaranteed |
| D3 | Chat surface: bottom-sheet Drawer for in-context chats, full page for general | Preserves screen state for in-context use; full screen for standalone conversations |
| D4 | Mastered list reorg: keep both `/words` and `/mastered` routes, animate transition between them | Minimal refactor vs route merge; deep links and existing logic preserved |
| D5 | Streaming inference (native callbacks → JS events) | Required for usable chat UX given 9–12s warm latency |
| D6 | Attachments Phase 1: images only (camera + gallery). Audio deferred to Phase 2 | Vision path is verified; audio path unverified in current LiteRT-LM build |
| D7 | Multi-turn vision: image included only in first attachment turn; subsequent turns are text-only | Avoids KV cache overflow and re-encoding cost |
| D8 | Attachment storage: IndexedDB Blob, 500 MB cap, 14-day LRU prune | Local-only privacy; storage pressure bounded |
| D9 | Pre-warm policy: setting toggle, default OFF | Memory/battery cost not justified for most users |
| D10 | Chat persistence: only general scope persists; word/wordbook/quiz scopes are volatile | Storage hygiene; in-context chats are short-lived |
| D11 | Messages table: single `ai_messages` with `role` column (NOT split user/ai tables) | Industry-standard schema; single-query timeline reads |
| D12 | Session schema supports multiple; Phase 1 UI exposes single rolling session only | Forward-compatible without UI cost in Phase 1 |
| D13 | `ai_tool_executions` table included in Phase 1 | Small marginal cost; large analytics value |
| D14 | Metrics: IndexedDB-only, no external send. Stats UI deferred to Phase 1.5 | Privacy-first; data accumulates while UI work is paced |
| D15 | Assistant footer label: `어시스턴트 / Assistant` | More descriptive than the generic `AI` |
| D16 | Web/Android/unsupported iOS users see fallback screen routing to model download | Honest discoverability without dead tab |
| D17 | Quiz mode: AI button enabled only after the user submits a rating | FSRS feedback isolation per quiz-maintainer rules |
| D18 | Bulk tool calls: aggregate per-toolName batches into a single multi-select confirmation card | Reuses existing scan WordPreview pattern; minimizes friction without sacrificing safety |
| D19 | Each new assistant turn with write tool calls = new confirmation card (no auto-approve carry-over) | Each batch must be reviewed explicitly |

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│ Footer (5 tabs):  Words | Wordbooks | Assistant | Quiz | Settings│
│   * /mastered tab removed; segmented toggle inside Words header   │
│                                                                    │
│ Chat surfaces:                                                     │
│   * General chat (Assistant tab): full page                        │
│   * Context chat (word/wordbook/quiz): bottom Drawer 70% → 100%    │
│                                                                    │
│ Persistence:                                                       │
│   * General scope: persisted via Repository                        │
│   * Context scopes: volatile (Zustand only, dropped on close)      │
└──────────────────────────────────────────────────────────────────┘

      ┌─────────────────┐         ┌──────────────────────┐
      │ React UI (web)   │ ─────▶ │ chat-store (Zustand)  │
      │   - Drawer       │         │  (app-shell mounted) │
      │   - Assistant tab│         │  - active inference  │
      │   - Confirm card │         │  - unread count      │
      └─────────────────┘         │  - pending confirms  │
                                  └──────────┬──────────┘
                            ┌─────────────────┴─────────────────┐
                            ▼                                   ▼
                  ┌──────────────────┐              ┌─────────────────────┐
                  │ Function executor│              │ Bridge adapter       │
                  │   - tool catalog │              │   - AI_INFER         │
                  │   - confirm gate │              │   - stream events    │
                  │   - Repository   │              │   - cancel propagate │
                  └──────────────────┘              └──────────┬──────────┘
                                                              │
                                          (window.postMessage / nativeMessage)
                                                              │
                                                              ▼
                  ┌────────────────────────────────────────────────────────┐
                  │ NivocaAiModule.swift (extended)                        │
                  │   existing: infer(prompt, imagePath) → string (OCR)    │
                  │   new:      inferStream(request, requestId) → events   │
                  │   new:      cancel(requestId)                          │
                  │   chat template: SimpleFormatMessages + tool injection │
                  └────────────────────────────────────────────────────────┘
```

## Native API Surface

The existing `infer(prompt, imagePath)` Swift function is preserved so OCR has
zero regression risk. A new function handles the chat path.

```swift
// new
AsyncFunction("inferStream") { (requestJson: String, requestId: String) -> Void in
  // requestJson:
  // {
  //   "messages": [
  //     { "role": "user", "content": [
  //         { "type": "text",  "text": "..." },
  //         { "type": "image", "path": "/cache/chat-img-xyz.jpg" }
  //     ]}
  //   ],
  //   "tools": [
  //     { "name": "add_word", "description": "...", "parameters": {...} }
  //   ],
  //   "options": { "maxOutputTokens": 1024, "temperature": 0.7 }
  // }
  // Response is emitted via Events; this function returns Void.
}

AsyncFunction("cancel") { (requestId: String) -> Void in
  // Calls into LiteRT-LM cancel API (exact name to be confirmed in PoC).
}

Events("onInferToken", "onInferDone", "onInferError")
// onInferToken: { requestId, delta }
// onInferDone:  { requestId, fullText, finishReason: "stop"|"length"|"tool_call" }
// onInferError: { requestId, code, message }
```

### Chat template extension

The current Swift code replaced LiteRT-LM's Rust minijinja template with a
hand-rolled `SimpleFormatMessages` that only handles single-turn vision OCR.
For chat we extend it to:

1. Prepend a system message containing the `tools` JSON definition when
   `tools` is non-empty.
2. Iterate `content` blocks per message, injecting `<start_of_image>` for
   image blocks (same token already used in OCR path).
3. Append `<start_of_turn>model\n` at the end of the message log.

The exact tool-call token format (official `<|tool_call>` vs. lowercase
`<tool_call>`) is validated in Phase 0 by capturing raw model output.

### Bridge message types

```ts
// apps/web/src/lib/native-bridge.ts additions
type WebToNativeMessage =
  | ...existing
  | { type: 'AI_INFER'; requestId: string; request: AiInferRequest }
  | { type: 'AI_INFER_CANCEL'; requestId: string };

type NativeToWebMessage =
  | ...existing
  | { type: 'AI_INFER_TOKEN'; requestId: string; delta: string }
  | { type: 'AI_INFER_DONE'; requestId: string; fullText: string; finishReason: 'stop'|'length'|'tool_call' }
  | { type: 'AI_INFER_ERROR'; requestId: string; code: string; message: string };

interface AiInferRequest {
  messages: AiMessage[];
  tools?: AiToolDef[];
  options?: { maxOutputTokens?: number; temperature?: number };
}

type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: string }
  | { type: 'tool_result'; toolName: string; toolCallId: string; result: unknown };
```

Image payloads cross the bridge as base64; the native side decodes into a
cache file and hands the file path to LiteRT-LM (mirrors the OCR pattern).

## Web AI Layer

```
apps/web/src/lib/ai/chat/
├── inference.ts        # request queue, stream parser, tool-call detection
├── tools.ts            # function catalog + executor
├── prompts.ts          # system prompts, context builders
├── store.ts            # Zustand store (app-shell mounted)
├── attachments.ts      # IndexedDB Blob storage, LRU pruning
├── persistence.ts      # general-scope history via Repository
├── metrics.ts          # IndexedDB-backed metric logger
└── types.ts            # shared types
```

### Data model

```ts
export type ChatScope =
  | { kind: 'general' }
  | { kind: 'word'; wordId: string }
  | { kind: 'wordbook'; wordbookId: string }
  | { kind: 'quiz'; sessionId: string; lastRating?: number };

export interface ChatSession {
  id: string;
  scope: ChatScope;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: ChatContentBlock[];
  toolCalls?: PendingToolCall[];   // assistant only
  status: 'streaming' | 'complete' | 'truncated' | 'cancelled' | 'failed';
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  modelVariant?: 'gemma-4-e2b' | 'gemma-4-e4b';
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
}

export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; attachmentId: string; previewUrl?: string }
  | { type: 'tool_result'; toolName: string; toolCallId: string; result: unknown; error?: string };

export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'awaiting_confirm' | 'running' | 'done' | 'cancelled' | 'failed';
  result?: unknown;
  error?: string;
  mutates: boolean;
}

export interface PendingToolBatch {
  id: string;
  toolName: string;
  items: Array<{
    callId: string;
    args: Record<string, unknown>;
    selected: boolean;
    status: 'pending' | 'running' | 'done' | 'failed';
    result?: unknown;
    error?: string;
  }>;
  status: 'awaiting_confirm' | 'running' | 'done';
}
```

### Stream parser

`<tool_call>...</tool_call>` regions are buffered; text outside them is
yielded as text deltas. JSON inside is parsed; malformed payloads emit a
`parse_error` event. Fuzzy matching (e.g., variant brackets) added once the
PoC reveals the actual token format.

### Tool collector and execution gate

Tool calls emitted in a single assistant turn are collected and routed:

```
parsed tool_call
   │
   ▼
TOOLS[name].mutates ?
   ├─ false → execute immediately, append tool_result to history,
   │           feed back to next inference
   └─ true  → buffer in writeBuckets[toolName] until turn end,
              render one confirmation card per bucket
```

Read-only tools (`search_words`, `find_similar`) auto-execute. Mutating
tools always require user confirmation. Heterogeneous mutating calls (e.g.,
delete + add in the same turn) produce one card per tool family, stacked
vertically.

### Attachments

```ts
const STORAGE_CAP_BYTES = 500 * 1024 * 1024;
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Dexie store: chat_attachments
// { id, blob, mimeType, width?, height?, byteSize, createdAt, lastAccessedAt }
```

Prune is triggered at app startup, on assistant tab open, and before each new
attachment is stored. Cross-device hydrate: messages keep `attachmentId`
refs; if the blob is missing locally, the UI renders an
`[image]` placeholder.

### Chat store (app-shell mounted)

The store lives at the `MobileShell` level (mirrors `scan-store`):

```ts
interface ChatStore {
  generalSession: ChatSession | null;
  contextSessions: Map<string, ChatSession>;
  activeInference: {
    sessionId: string;
    requestId: string;
    startedAt: number;
    streamingMessageId: string;
  } | null;
  lastViewedAt: Map<string, number>;
  unreadCount: number;
  pendingConfirms: PendingToolBatch[];
}
```

A `MobileShell` effect subscribes to store transitions and fires toasts
when:
- inference completes while the user is not on `/assistant`
- a new `pendingConfirm` arrives while off the assistant tab

The bridge listener is installed once at the app shell level so events flow
into the store regardless of which page is mounted.

## Footer Reorganization

```
Before:  [Words] [Wordbooks] [Quiz] [Mastered] [Settings]
After:   [Words] [Wordbooks] [Assistant] [Quiz] [Settings]
```

`/mastered` route is preserved (deep links unbroken); the tab entry is
removed and replaced by the `WordsListToggle` segmented control in the
`/words` and `/mastered` headers. The toggle navigates between the two
routes using the View Transitions API for a toggle-like feel; older WebViews
fall back to plain navigation.

The Mastered page retains its existing logic (different default sort, swipe
color, context menu). Sharing logic was rejected as over-refactor.

## Chat UI

### Drawer (context chat)

Built on shadcn `Drawer` (vaul). Default snap point 70%, draggable to 100%.
On close, the context session remains in memory until the user leaves the
page (cleanup effect drops it).

### Assistant page

`/assistant` is a full-page chat. Header includes a "New chat" icon button
that clears the persisted general session after a confirmation dialog.
Setting `lastViewedAt[generalSession.id] = now()` on entry clears
`unreadCount`.

### Message components

- `UserBubble`: right-aligned; renders text + image previews in one bubble.
- `AssistantBubble`: left-aligned; streaming dot indicator while
  `status === 'streaming'`; tool calls rendered inline (read-only result
  cards, mutating confirm cards).
- `ToolResultBubble`: pill-style row showing the tool result returned to the
  model.

### Tool confirmation card (batch)

```
┌─────────────────────────────────────────────┐
│  AI requests the following (5)              │
│  Add to wordbook "Japanese spring"          │
│                                             │
│  [x] 桜 (さくら) — cherry blossom      [×]  │
│  [x] 梅 (うめ) — plum                  [×]  │
│  [x] 椿 (つばき) — camellia            [×]  │
│  [x] 桃 (もも) — peach                 [×]  │
│  [ ] 蘭 (らん) — orchid                [×]  │
│                                             │
│  [Select all] [Deselect all]                │
│  ─────────────────────────────────────────  │
│  [   Cancel   ]  [   Execute (4)   ]        │
└─────────────────────────────────────────────┘
```

Reuses the existing `WordPreview` checkbox-row pattern from the scan flow.
After execution, the card transforms to a status summary
(`✓ 4 done · ✗ 0 failed · — 1 skipped`). Tool result fed back to the model
includes executed, failed, and `skipped_by_user` arrays.

### Fallback (unsupported environments)

`/assistant` checks at mount:

| Condition | Screen |
|---|---|
| `!isNativeApp()` | "AI assistant is only available in the iOS app" |
| `lastDeviceSupported === false` | "Device unsupported" |
| `snapshot.installed.length === 0` | "Download the AI model" → CTA `/settings/ocr` |

## Function Catalog

### Group A — Word CRUD (mutates: true)

| Name | Description |
|---|---|
| `add_word` | Add a new word to the user's personal list |
| `edit_word` | Edit reading/meaning/JLPT of an existing word |
| `delete_word` | Permanently delete a word |
| `set_mastered` | Toggle mastered state (`user_word_state` path per quiz-maintainer) |

### Group B — Wordbook CRUD (mutates: true)

| Name | Description |
|---|---|
| `create_wordbook` | Create a new wordbook |
| `edit_wordbook` | Rename or edit description |
| `delete_wordbook` | Delete the wordbook (words preserved) |

### Group C — Relations (mutates: true)

| Name | Description |
|---|---|
| `add_word_to_wordbook` | Add an existing word to a wordbook |
| `remove_word_from_wordbook` | Remove a word from a wordbook |

### Group D — Read-only (mutates: false, auto-executes)

| Name | Description |
|---|---|
| `search_words` | Search the user's vocabulary by term/reading/meaning (limit 20) |
| `find_similar` | Marker tool. No DB call. Acknowledges the user's intent to receive related-word suggestions; the model emits suggestions in its next response or via `add_word` calls |

Deferred to Phase 1.5: `generate_example_sentence`.

### Tool result feedback shape

Batch execution returns a single result back to the model:

```json
{
  "tool": "add_word",
  "batch_id": "abc",
  "executed": [{"args": {...}, "result": {"id": "..."}}, ...],
  "failed": [{"args": {...}, "error": "duplicate_term"}],
  "skipped_by_user": [{"args": {...}, "reason": "deselected"}]
}
```

## System Prompts

Base prompt (shared across all scopes):

```
You are the user's Japanese vocabulary study assistant. You can use tools to
interact with the user's vocabulary list and wordbooks.

Tool rules:
- When the user requests multiple related actions in one ask, emit ALL
  related tool calls in the SAME assistant turn. Do not wait for results
  between related calls.
- Mutating actions are reviewed and approved by the user before execution.
  After approval, you receive results in a tool_result message. Skipped
  items are also reported.
- Use search_words to look up the user's existing words by name/reading/
  meaning before edit_word, delete_word, or add_word_to_wordbook.
- Do NOT invent word IDs. If you don't have one, search first.
- Do NOT call delete_* unless the user explicitly asks to delete.
- Respond in the user's language ({locale}). Japanese terms stay in Japanese.

Tool call format:
<tool_call>{"name": "tool_name", "arguments": {...}}</tool_call>
```

Scope-specific context blocks are appended:

**Word scope** (word detail → AI):
```
You are helping the user understand a specific word.

CURRENT WORD:
  term: 桜
  reading: さくら
  meaning: cherry blossom
  jlpt: N4
  priority: 3
  mastered: false
  wordbooks: [Japanese spring, JLPT N4 basics]
```

**Wordbook scope** (wordbook detail → AI):
```
You are helping the user with their wordbook.

CURRENT WORDBOOK:
  id: wb-abc
  name: Japanese spring
  description: Spring-related vocabulary
  totalWords: 47
  sampleWords (priority desc, max 30):
    桜 (さくら) — cherry blossom (priority: 5)
    梅 (うめ) — plum (priority: 4)
    ... (28 more)

If you need words not in this sample, use search_words.
```

**Quiz scope** (quiz screen → AI, post-rating only):
```
The user just answered a quiz card and asked for help.

CURRENT CARD:
  term: 桜
  reading: さくら
  meaning: cherry blossom
  user's rating: again | hard | good | easy

Provide explanation, mnemonics, or example sentences. Do not influence
future ratings — the user has already rated this card.
```

Token budget guard: system prompt + tools + history must stay under
`max_num_tokens = 2048`, reserving ~600 for output and ~200 for the next
user message. Older messages are trimmed first; the UI surfaces a
`[earlier messages omitted]` separator when truncation occurs.

## Database Schema

### `ai_sessions`

```sql
create table if not exists ai_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  scope           text not null default 'general'
                  check (scope in ('general')),
  scope_entity_id text,
  title           text,
  context_snapshot jsonb,
  last_message_at timestamptz,
  message_count   integer not null default 0,
  total_input_tokens  integer not null default 0,
  total_output_tokens integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index ai_sessions_user_active_idx on ai_sessions(user_id, last_message_at desc nulls last);
alter table ai_sessions enable row level security;
create policy "users access own sessions" on ai_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `ai_messages` (unified, role column)

```sql
create table if not exists ai_messages (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references ai_sessions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('user','assistant','tool','system')),
  content         jsonb not null,
  tool_calls      jsonb,
  status          text not null default 'complete'
                  check (status in ('streaming','complete','truncated','cancelled','failed')),
  finish_reason   text,
  input_tokens    integer,
  output_tokens   integer,
  model_variant   text,
  error_code      text,
  error_message   text,
  attachment_ids  jsonb,
  created_at      timestamptz not null default now()
);

create index ai_messages_session_created_idx on ai_messages(session_id, created_at);
create index ai_messages_user_idx on ai_messages(user_id);
alter table ai_messages enable row level security;
create policy "users access own messages" on ai_messages for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `ai_tool_executions` (analytics + status history)

```sql
create table if not exists ai_tool_executions (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references ai_messages(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  tool_name       text not null,
  tool_call_id    text not null,
  args            jsonb not null,
  status          text not null
                  check (status in ('awaiting_confirm','running','done','cancelled','failed','skipped_by_user')),
  result          jsonb,
  error_message   text,
  duration_ms     integer,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index ai_tool_executions_user_tool_idx on ai_tool_executions(user_id, tool_name, created_at desc);
alter table ai_tool_executions enable row level security;
create policy "users access own tool exec" on ai_tool_executions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### IndexedDB (Dexie) stores

```ts
// dexie schema version bump
ai_sessions:        '++id, userId, lastMessageAt',
ai_messages:        '++id, sessionId, createdAt, [sessionId+createdAt]',
ai_tool_executions: '++id, messageId, toolName, createdAt',
chat_attachments:   'id, createdAt, lastAccessedAt, byteSize',
ai_metrics:         '++id, event, timestamp, [event+timestamp]',
```

Binary attachments live only in IndexedDB (never uploaded). Other tables
mirror the Supabase schema for guest users.

## Repository Interface

```ts
export interface DataRepository {
  words: WordRepository;
  study: StudyRepository;
  wordbooks: WordbookRepository;
  chat: ChatRepository;       // new
  exportAll(): Promise<...>;
  importAll(data: ...): Promise<...>;
}

export interface ChatRepository {
  // Sessions
  getCurrentSession(): Promise<ChatSession | null>;
  listSessions(limit?: number): Promise<ChatSession[]>;
  createSession(scope: ChatScope, contextSnapshot?: unknown): Promise<ChatSession>;
  updateSessionTitle(sessionId: string, title: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  clearAllSessions(): Promise<void>;

  // Messages
  appendMessage(message: ChatMessage): Promise<void>;
  updateMessageStatus(messageId: string, status: MessageStatus, finishReason?: string): Promise<void>;
  listMessages(sessionId: string, limit?: number, before?: number): Promise<ChatMessage[]>;

  // Tool executions
  recordToolExecution(execution: ToolExecution): Promise<void>;
  updateToolExecution(id: string, patch: Partial<ToolExecution>): Promise<void>;

  // Attachments (IndexedDB only; exposed through Repository for layer consistency)
  storeAttachment(blob: Blob, meta: { mimeType: string; width?: number; height?: number }): Promise<string>;
  getAttachment(id: string): Promise<Blob | null>;
  pruneAttachments(): Promise<{ freedBytes: number; removedCount: number }>;
}
```

All chat data access flows through `useRepository().chat`.

## i18n Keys

All user-facing strings go through i18n (`types.ts` + `en.ts` + `ko.ts`).
Korean quoted text uses corner brackets (`「」`, U+300C / U+300D).

```ts
// New / changed scopes
nav.assistant
words.activeTab, words.masteredTab
common.view, common.review

assistant.{title, openContextChat, newChat, newChatConfirm,
  inputPlaceholder, attachImage, send, cancel,
  typing, thinking, preparing,
  responseReady, toolConfirmNeeded(count),
  toolCard.{title(count), execute(count), selectAll, deselectAll,
            statusRunning, statusDone(n), statusPartial(done, failed, skipped),
            actionFor.{add_word(term), edit_word, delete_word(term),
                       set_mastered(term, mastered), create_wordbook(name),
                       edit_wordbook, delete_wordbook(name),
                       add_word_to_wordbook(term, wbName),
                       remove_word_from_wordbook(term, wbName)}},
  fallback.{webNotSupported, webNotSupportedHint, deviceTooWeak,
            modelNotInstalled, modelNotInstalledCta},
  error.{generateFailed, cancelled, modelMissing},
  imageBlockedInHistory, contextTruncated}
```

## Metrics

Local-only. Recorded via `recordMetric(event, payload)` which writes to
IndexedDB `ai_metrics` (TTL 90 days, max 10,000 rows) and forwards to
`logger.info` for debug builds.

Events: `chat.message_sent`, `chat.inference_start`,
`chat.inference_done`, `chat.inference_error`, `chat.tool_call_parsed`,
`chat.tool_batch_confirmed`, `chat.tool_batch_executed`,
`chat.cancelled_by_user`, `chat.context_truncated`,
`chat.attachment_stored`, `chat.attachment_prune`.

No external transmission. Stats UI deferred to Phase 1.5
(`/settings/ai-stats`).

## Testing Strategy

### Unit (Vitest)
- `inference.test.ts` — stream parser edge cases (interleaved tool/text,
  truncated `<tool_call>`, nested quotes, malformed JSON, missing close)
- `tools.test.ts` — executor argument mapping, batch partial-select,
  tool_result shape including `skipped_by_user`
- `prompts.test.ts` — scope-specific prompt assembly, 30-word sample limit,
  token trim correctness
- `attachments.test.ts` — round-trip, 14-day TTL, 500 MB LRU
- `store.test.ts` — hydrate/persistence, unreadCount, pendingConfirms

Mocks: `useRepository`, `sendToNative`, `crypto.randomUUID`.

### E2E (Playwright)
- `assistant-general.spec.ts` — message round-trip with mocked native
  bridge
- `assistant-tool-confirm.spec.ts` — bulk add_word from wordbook detail,
  deselect one, execute, verify Repository calls
- `assistant-fallback.noauth.spec.ts` — non-native + guest → fallback
- `words-mastered-toggle.spec.ts` — segmented control transitions
- `quiz-assistant-isolation.spec.ts` — AI button disabled pre-rating,
  enabled post-rating; drawer preserves quiz state

Fixture: `e2e/fixtures/ai-bridge-mock.ts` injecting a mock
`window.NiVocaBridge` that scripts streaming responses per request.

### PoC (Phase 0)
`apps/mobile/scripts/poc-tool-calling.ts` — scenario catalog executed on a
real device, measuring tool-call accuracy, false positives, multi-call
batching behavior, and OCR regression. Pass criteria:
- True positive ≥ 9/10 (intended tool called with correct args)
- False positive ≤ 1/10 (tool called when no CRUD intent)
- Multi-action prompts emit all related tool_calls in the same assistant
  turn ≥ 8/10 (vs. one-at-a-time across turns)
- Mean text-only inference ≤ 15s on iPhone 15 Pro
- JSON args parse rate ≥ 95%
- OCR scenarios unaffected

## Phased Rollout

### Phase 0 — PoC + Foundation (gate, 1–2 days)
- Native `inferText(messages, tools)` (blocking, no streaming yet)
- Tools JSON injection (try official tokens and SimpleFormat extension)
- PoC scenario catalog on a real device
- Capture raw model output to confirm `<tool_call>` token format
- OCR regression check (one scan scenario)
- **Gate**: criteria above must all pass

### Phase 1 — Core MVP (5–7 days)
A. Native streaming + cancel API
B. Supabase migration + Dexie store + ChatRepository
C. Chat store at app shell + background pattern
D. Function catalog (10 tools) + executor + batch confirm
E. Chat UI (Drawer, Assistant page, message components, image attachments)
F. Word/Wordbook/Quiz integration (AI buttons + scope mapping, FSRS
   isolation)
G. Mastered segmented toggle + footer reorg
H. i18n + tests

**Gate**: unit + E2E pass, PoC scenarios revalidated, OCR regression zero,
Lighthouse + memory check on the Assistant page.

### Phase 1.5 — Stabilization (2–3 days, post-launch)
- `generate_example_sentence` tool
- `/settings/ai-stats` page
- Per-message thumbs-up/down feedback
- Multi-session UI (session list, auto title, restore old conversation)
- Pre-warm toggle in settings
- Error-message UX polish

### Phase 2 — Expansion (separate cycle)
- Audio attachments (`audio_backend` verification, mic recording UI)
- OCR ↔ chat integration (`extract_words_from_image` tool)
- Vertex/Gemini API fallback for Android/Web
- Optional anonymous Supabase metric ingestion
- Context-truncation auto-summary

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Gemma 4 E2B int4 tool-call accuracy insufficient | Phase 0 gate; fallback to E4B or prompt boost |
| R2 | `SimpleFormatMessages` cannot reproduce the official chat template faithfully | Compare raw output in Phase 0; restore parts of minijinja if needed |
| R3 | LiteRT-LM C API streaming variant name/signature unverified | Confirm in v0.11.0 headers; fallback to token polling |
| R4 | Multi-turn token budget overflow | Trim + UI truncation indicator |
| R5 | iOS Jetsam kills long sessions | Measure memory; consider periodic engine teardown |
| R6 | Confirmation friction frustrates power users | Phase 2: optional auto-approve toggle in settings |
| R7 | View Transitions API missing on older iOS WebViews | Plain navigation fallback |
| R8 | Unsupported users get a dead Assistant tab | Explicit fallback screens with CTAs to model setup |

## Open Items (resolved in PoC)

- Exact `<tool_call>` token format produced by Gemma 4 E2B int4 with the
  patched LiteRT-LM build.
- LiteRT-LM v0.11.0 C API token-streaming function name and callback ABI.
- Whether `find_similar` as an ack-only marker is intuitive to the model or
  should be replaced by system-prompt-only instructions.
- Audio backend correctness (Phase 2 PoC).

## Checklist

### Phase 0
- [ ] Implement `inferText(messages, tools)` blocking variant in
      `NivocaAiModule.swift`
- [ ] Extend `SimpleFormatMessages` for tool injection + content blocks
- [ ] Write `apps/mobile/scripts/poc-tool-calling.ts` with the scenario
      catalog
- [ ] Run PoC on a physical iPhone 15 Pro (existing test device)
- [ ] Capture raw model output for tool-call token format
- [ ] Document results in `_docs/ai-chat-poc-results.md`
- [ ] Confirm OCR scan unaffected
- [ ] Decide go / no-go for Phase 1

### Phase 1 — Infra
- [ ] Add `inferStream` + `cancel` Swift functions with streaming events
- [ ] Wire `onInferToken`/`onInferDone`/`onInferError` event channels
- [ ] Extend `apps/web/src/lib/native-bridge.ts` with new message types
- [ ] Web bridge adapter: `streamInfer`, cancel propagation
- [ ] Stream parser + `TurnToolCallCollector`

### Phase 1 — DB
- [ ] Supabase migration `0XX_ai_chat.sql` (ai_sessions, ai_messages,
      ai_tool_executions)
- [ ] Add migration filename to `scripts/run-migrations.ts`
- [ ] Dexie version bump (ai_sessions, ai_messages, ai_tool_executions,
      chat_attachments, ai_metrics)
- [ ] `ChatRepository` interface in `lib/repository/types.ts`
- [ ] Supabase implementation in `supabase-repo.ts`
- [ ] IndexedDB implementation in `indexeddb-repo.ts`
- [ ] `attachments.ts` (store/get/prune)
- [ ] `metrics.ts` (recordMetric)

### Phase 1 — Store + background
- [ ] Zustand `chat-store.ts` mounted at app shell
- [ ] `MobileShell` effect: toast/badge on cross-page state changes
- [ ] Bridge listener installed once at root

### Phase 1 — Tools
- [ ] Define 10 tools in `tools.ts` with JSON schemas and executors
- [ ] Read-only auto-execute path
- [ ] Mutating confirm-gate path
- [ ] Batch collector with per-toolName grouping
- [ ] Tool result feedback shape including `skipped_by_user`

### Phase 1 — UI
- [ ] `/assistant/page.tsx` (full page) + fallback variants
- [ ] `<ChatDrawer>` (vaul, 70%/100% snap)
- [ ] `<ChatMessageList>` with virtualization
- [ ] `<ChatInputBar>` with image attachment
- [ ] `<UserBubble>` / `<AssistantBubble>` / `<ToolResultBubble>`
- [ ] `<ToolConfirmCard>` reusing `WordPreview` checkbox-row pattern
- [ ] BottomNav 5-tab reorg (Assistant in center)
- [ ] `<WordsListToggle>` segmented control
- [ ] View Transitions on toggle + CSS keyframes
- [ ] AI icon buttons on Words / Wordbook detail / Quiz / Word detail /
      Mastered detail headers

### Phase 1 — Quiz integration
- [ ] AI button disabled until rating submitted (SRS only)
- [ ] Quiz scope mapping with `lastRating`
- [ ] Drawer preserves quiz session state

### Phase 1 — i18n + tests
- [ ] Triad sync (`types.ts`, `en.ts`, `ko.ts`)
- [ ] Unit tests (parser, tools, store, prompts, attachments)
- [ ] E2E tests (general, tool-confirm, fallback, mastered-toggle,
      quiz-isolation)
- [ ] AI bridge mock fixture

### Pre-merge gates
- [ ] All unit + E2E pass
- [ ] PoC scenarios re-validated on device
- [ ] OCR regression confirmed zero
- [ ] TypeScript: zero errors in modified files (project policy)
- [ ] Lint clean
- [ ] Memory leak check (drawer open/close × 50)
- [ ] Token budget enforced (no overflow in test scenarios)

## Implementation Notes

(populated during implementation)

## User Feedback

(populated after user testing)

## Final Summary

(populated post-completion)
