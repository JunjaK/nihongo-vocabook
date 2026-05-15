# AI Assistant — Phase 1 Implementation Notes

> Status: Implementation complete — pending user review
> Generated: 2026-05-14

## Summary

All Phase 1 implementation tasks complete:
- 1J: mastered segmented toggle ✓
- 1K: per-page AI buttons (word/wordbook/quiz) ✓
- 1E: native Swift streaming + cancel ✓
- 1F: WebView ↔ native streaming forwarder ✓
- 1M: unit tests — 37 new tests (parser/tools/store), all 119 web tests pass ✓

What remains:
- Phase 0.7 — simulator runs ×3 (interactive, requires you to download Gemma 4 model in the app first)
- Phase 0.9 — accuracy go/no-go (depends on 0.7)
- Phase 0.8 — OCR regression check (separate session per your instruction)
- E2E tests for the chat flow (Phase 1 didn't budget them; recommend adding to Phase 1.5)
- Physical device tests for the streaming path (model + entitlement gated)

Verifications run:
- `bunx tsc --noEmit` in `apps/web` → exit 0
- `bunx tsc --noEmit` in `apps/mobile` → exit 0
- `bunx vitest run` in `apps/web` → 119 passed (37 new)

This file collects **decisions made without explicit user approval** during the autonomous Phase 1 push. Review the bullets marked **NEEDS REVIEW** when you're back.

---

## Convention decisions

### 1. Header `desc` prop now accepts `ReactNode`
- **Why:** The mastered toggle is a button group, not a string.
- **What:** `apps/web/src/components/layout/header.tsx` branches on `typeof desc === 'string'` — strings still get the `text-badge text-text-tertiary` styling, non-string nodes render as-is.
- **Side effect:** `/words` and `/mastered` headers no longer show the `「총 단어 수: N개」` count — the count is now implicit (you see the toggle, not the number). **NEEDS REVIEW** if you want the count back somewhere (could move to ListToolbar or below the toggle).

### 2. WordsListToggle visual style
- Pill segmented control: `rounded-full bg-secondary p-0.5`, selected pill = `bg-background shadow-sm`.
- View Transitions API: `document.startViewTransition(() => router.push(href))` — graceful fallback via `'startViewTransition' in document` guard.
- CSS keyframes added in `globals.css` (`::view-transition-old(root)` fade-out 180ms, `::view-transition-new(root)` fade-in 220ms with 4px slide).
- `prefers-reduced-motion` honored.

---

## Open questions / NEEDS REVIEW

### Q1: Mastered toggle replaced word-count display — RESOLVED
- Per user feedback: count moved to the **rightmost end of the header actions row** (after the OCR scan button on /words; standalone on /mastered).
- Style: `text-badge font-medium text-text-tertiary tabular-nums`.

### Q2: Quiz AI button gate — RESOLVED (per-card-type visibility)
- **Flashcard**: button visible only after the user reveals the answer (`onRevealedChange`).
- **ExampleQuizCard**: button visible only after the user picks an answer (`onPhaseChange === 'revealed'`).
- Visibility gating (not disabled+toast), per user preference. Reset to hidden on every `advanceToNext`.

### Q4 (new): Quiz AI conversations are ephemeral by default — RESOLVED
- Per user: "퀴즈 세션에서 사용되는 ai는 임시 context"
- Implementation: `shouldPersistScope(scope)` helper in store. `general` → always persists. `quiz` → only if `getSaveQuizAiSessions()` returns true. `word`/`wordbook` → never persisted.
- Toggle storage: `localStorage['nivoca.assistant.save-quiz-sessions']`, default OFF.
- Settings UI: `Settings → 퀴즈 → AI Assistant → 퀴즈 AI 대화 저장` toggle.
- `ensureSession` now lazily creates a DB session for quiz scope when the toggle is ON, so subsequent `appendMessage` calls have a parent row.
- New files: `apps/web/src/lib/ai/assistant-prefs.ts`.

### Q3: Quiz scope shape — RESOLVED (session-stable, `lastRating` dropped)
- Single `sessionId` per quiz mount → chat context (messages, tool calls) persists across cards inside the store's `contextSessions['quiz:<sessionId>']` slot.
- `currentWordId` is re-injected as the user moves between cards — system prompt sees the live card.
- Removed `lastRating` from the call site (the scope type still accepts it as optional for forward-compat).
- Button is hidden entirely when the session ends (`showReport || dailyComplete || cards.length === 0`).

---

## Phase 1.1 — Parser polish ported from PoC v3

### What changed
- `apps/web/src/lib/ai/chat/parser.ts` got the v3 PoC tolerances:
  - **Multi-call splitting**: a single `<tool_call>` body containing N comma-separated `{...}` objects now yields N `tool_call` events instead of one `parse_error`.
  - **Name-prefix recovery**: `tool_name{...}` (model emits the tool name outside the JSON body) is parsed as `name=tool_name, args=inner`.
  - **Trailing garbage**: `{...}$$` or `{...} extra` is recovered via balanced-brace extraction.
  - **Auto-close**: if `{` or `[` are unbalanced at end-of-body (model truncated), missing closers are appended and parsing retries once. Same logic applies inside `feed()` (when the close tag arrives) AND inside `flush()` (stream EOS without close tag).
  - **Permissive flush**: an unterminated `<tool_call>` at flush is now recovered via the same rebalance retry, not auto-emit `parse_error`.
- `apps/web/src/lib/ai/chat/parser.test.ts` — 7 new test cases covering each tolerance (19 tests total, all passing).

### Why
PoC v3 showed Gemma 4 E2B int4 produces all five quirks 5-15% of the time on CPU inference. With the strict pre-v3 parser, the same model output that scored 60% on PoC scored 90% on v3. Production chat would have hit the exact same parser cliffs, so porting was the cheapest win available.

### Phase 2.5 — Audio attachments + MTP (2026-05-15)

### Audio attachment plumbing → full implementation
- **Dependencies added** (`apps/mobile`): `expo-audio@55.0.14`, `expo-document-picker@55.0.13`
- **Info.plist**: `NSMicrophoneUsageDescription` added
- **Native bridge** (`audio-bridge.ts`): imperative `startAudioRecording / stopAudioRecording / cancelAudioRecording / pickAudioFile` via `AudioModule.AudioRecorder` (the class on the module — `expo-audio` only exports the React hook + type from `expo-audio` root)
- **Bridge messages**:
  - WebToNative: `AUDIO_RECORD_START / STOP / CANCEL`, `PICK_AUDIO_FILE`
  - NativeToWeb: `AUDIO_RECORD_TICK / RESULT / CANCELLED / ERROR`, `AUDIO_FILE_RESULT / CANCELLED`
- **Web `ChatInputBar`** rewrite:
  - Added mic button next to image-attach (now accepts `image/*,audio/*` via HTML file input)
  - `RecordingBar` component replaces the input row while recording — elapsed/30s, progress fill, stop + cancel
  - `AudioChip` in pending attachments — play/pause + duration
  - 30s auto-stop cap
- **`AudioBlock`** in `chat-message.tsx` — HTML5 audio player for replaying sent audio
- **Swift `runTextInference` / `startTextStream`** refactored:
  - Last user message no longer flattened into prompt text; instead becomes a proper multi-block conversation payload (`text` + zero-or-more `image`/`audio` blocks with file paths)
  - `resolveMediaPath()` accepts `data:<mime>;base64,...` URLs, decodes to a temp file under cachesDirectory, and the conversation API consumes the path
  - Temp files cleaned up via `defer` (blocking) or `StreamContext.tempFiles` (streaming)
- **store.ts** — attachment sources now resolved to `data:` URLs via `blobToDataUrl(blob)` (Object URLs are renderer-only and the native side can't fetch them)
- **i18n**: `recordAudio / recordStop / recordCancel`, error keys `micPermissionDenied / recordFailed / recordNotSupportedOnWeb`

**What's still untested**: actual Gemma 4 audio inference on physical device. Code path is in place but needs a real iPhone with the entitlement set, the model downloaded, and a recorded clip to verify the model handles `{"type":"audio","path":"..."}` blocks in the conversation API.

### MTP (multi-token prediction) — re-enabled on GPU
- Flipped `litert_lm_engine_settings_set_enable_speculative_decoding` from hard-off to **per-backend**:
  - `gpu/gpu` with **MTP=true** (primary — Google's official recommendation for Gemma 4 GPU, 2-3× decode speedup)
  - `gpu/gpu` with **MTP=false** retry slot (in case v0.11.0's drafter K-token shape bug resurfaces — preserves the historical fallback)
  - `cpu/gpu` and `cpu/cpu` stay MTP=false (E2B is NOT a recommended CPU MTP target per docs — E4B would be)
- `tryCreateEngine` signature gained `enableMtp: Bool`
- Comment in code updated to point at Google's [Gemma 4 LiteRT-LM page](https://ai.google.dev/edge/litert-lm/models/gemma-4) and [C++ guide](https://ai.google.dev/edge/litert-lm/cpp) for context

**Why it was off before**: v0.11.0 of LiteRT-LM hit a `DYNAMIC_UPDATE_SLICE` shape mismatch between the drafter's K-tokens-per-step writes and the main decoder's K=1 slice. We diagnosed it as path-sensitive (only on GPU paths) and turned it off project-wide as a safe default. Now that entitlement is sorted and physical-device GPU is exercisable, the right answer is to enable per-backend and fall back gracefully — which is what the new attempt chain does.

**Requires a native rebuild** to take effect.

## Phase 2 — Four feature batch (2026-05-15)

User skipped #3 (cloud fallback). Shipped #1, #2, #4, #5.

### 2.2 `extract_words_from_image` tool
- New chat tool, mutates: false. Reuses existing native vision pipeline (`extractViaBridge`) so users can drop an image into the chat and say "이 사진 단어 추출해줘" — the assistant calls the tool, gets candidates, and proposes `add_word` calls.
- Helper `blobToDataUrl()` in `tools.ts` converts the stored attachment into the data URL the native bridge expects.

### 2.4 Anonymous telemetry upload
- New `030_ai_telemetry.sql` migration: `ai_telemetry` table, RLS insert-only for authed users, no-read-from-client policy.
- `ChatRepository.uploadTelemetry(events)` with **two defensive scrub layers**: `coerceCounters` in metrics.ts trims to primitives, `scrubPayload` in supabase-repo.ts re-validates length/whitespace before insert.
- `telemetry-uploader.ts` batches events (max 50 or every 60s, flushes on visibilityHidden). Toggle-aware: queue is dropped when the user flips OFF.
- Whitelist of telemetry-eligible events in `metrics.ts` keeps free-form ones (e.g. `chat.tool_call_parsed` with raw call text) local-only.
- Toggle UI: Settings → 퀴즈 → AI Assistant → 익명 사용 통계 공유 (default OFF).

### 2.5 Context auto-summary
- New `031_ai_session_summary.sql` migration: `context_summary`, `summarized_through_message_id`, `summarized_message_count` columns on `ai_sessions`.
- `summarizeIfNeeded(sessionId)` action runs opportunistically after each successful inference completes. Idempotent (module-level `summarizeInflight` Set guards re-entry).
- Trigger: 4+ messages past the current cutoff AND combined text >= 800 chars (~200 tokens) — otherwise no-op.
- Strategy: keeps the last 4 turns verbatim, summarizes everything before. Calls `streamInfer` with a tight summary system prompt (locale-aware), 280 max output tokens. Result merged into existing summary if any.
- Live inference path: prepends `[Summary of earlier conversation]\n<summary>` to the system prompt and skips messages up to `summarizedThroughMessageId`.
- UI: small pill at the top of the chat list — "이전 메시지 N개가 요약되어 컨텍스트에 포함되어 있습니다".

### 2.1 Audio attachment plumbing (UI deferred)
- `BridgeAiInferContentBlock`, `AiInferContentBlock`, and `ChatContentBlock` all gained an `audio` variant.
- `MessageLike` + `estimateMessageTokens` count audio at 384 tokens (rough placeholder until verified).
- Swift `TextInferRequest.ContentBlock` is already a `type: String` discriminator; audio blocks decode but are dropped in the prompt-only flatten — Swift handling will land alongside the recording UI.
- **NOT shipped this session** (deferred to Phase 2.5):
  - `expo-audio` install + iOS NSMicrophoneUsageDescription
  - Recording UI in `ChatInputBar`
  - Swift conversation-API audio routing (`{"type":"audio","path":"..."}` block, file write from base64)
  - Real-device verification of Gemma 4's audio handling
- Why deferred: native rebuild + physical-device mic testing required. Type plumbing is in place so the follow-up session can wire UI → bridge → Swift without churning interfaces.

### Verification (Phase 2 cumulative)
- web tsc: 0
- mobile tsc: 0
- web tests: 138 passed (no test churn — feature surfaces unit-testable, UI deferred to E2E in Phase 1.5)

## Phase 1.5 — Six feature batch (2026-05-15)

All six items from the original Phase 1.5 list shipped in one push:

### 1.5.1 `generate_example_sentence` tool
- New `addExample(wordId, {sentenceJa, ...})` method on `WordRepository`
- Supabase repo resolves word → dictionary_entry_id → inserts row with `source: 'ai_generated'`
- Guest stub → LOGIN_REQUIRED
- New tool in `tools.ts` (mutates: true). The assistant emits one tool call per sentence; user approves via confirm card.

### 1.5.2 AI pre-warm toggle
- Swift `prewarm()` AsyncFunction calls `ensureLoaded()` without inference
- Mobile bridge: `AI_PREWARM` message type → native side calls `NivocaAi.prewarm()`
- Web `assistant-prefs`: `getPrewarm() / setPrewarm()` (localStorage, default OFF)
- `MobileShell` re-attempts prewarm every 1.5s until bridge is ready, also fires on toggle change
- Settings → 퀴즈 → AI Assistant section now has the toggle (native-only visible)

### 1.5.3 Per-message thumbs-up/down feedback
- Supabase migration `029_ai_message_feedback.sql` adds nullable enum column + index
- `ChatRepository.setMessageFeedback(messageId, value)` with optimistic local patch
- `ChatMessage.feedback?: 'thumbs_up' | 'thumbs_down'`
- UI: thumb buttons below assistant message bubble (only after streaming completes)

### 1.5.4 `/settings/ai-stats` page
- Reads from existing local IndexedDB metrics (chat.metrics.ts already records events)
- Aggregates messages sent, inference count, avg latency, output tokens, errors, cancelled, top tool calls (with failure subscript)
- Link added to `/settings` (Quiz section, next to quiz-stats)
- Pure local — explicit "never sent to a server" hint at bottom

### 1.5.5 Multi-session UI
- Auto-title: first user message in a fresh general session becomes the title (truncated to 40 chars, suffix `…`)
- Store actions: `listGeneralSessions / loadGeneralSession / startNewGeneralSession / deleteGeneralSession / renameGeneralSession`
- New `/assistant/sessions` page — list + delete + open
- Assistant page header gained a BookOpen icon linking to sessions and the existing `+` button now `startNewGeneralSession()` (preserves history instead of clearing all)

### 1.5.6 Error UX polish
- Failed assistant bubbles now show errorCode underneath the message (uppercase tracking)
- `generateFailed` / `modelMissing` copy made actionable (suggests next step)
- ChatInputBar attach failures now surface as toast instead of silent console error
- New `attachFailed` i18n key

### Verification
- web tsc: 0
- mobile tsc: 0
- web tests: 138 passed (added 12 from the existing batch since Phase 1.2)
- No new tests written specifically for 1.5 items — UI surfaces are exercised by the existing unit tests for store + tools

## Phase 1.2 — `fp-explain-word` few-shot ported
- `apps/web/src/lib/ai/chat/prompts.ts` `baseSystemPrompt(locale)` now includes:
  - An "IMPORTANT — when to NOT call a tool" section listing the explain-word + meta-question + non-data-action carve-outs.
  - A locale-aware one-shot example ("桜 뜻이 뭐야?" → natural-language answer, no tool) — Korean variant for `ko`, English variant for `en`.
- This matches the PoC v3 preamble that flipped `fp-explain-word` from always-fail to 3/3 stable pass.
- The rest of the base prompt structure (tool rules, format reminder) is unchanged.

## Phase 1E/1F decisions (native streaming)

### Stream API choice
- Used `litert_lm_conversation_send_message_stream` (non-blocking) + `litert_lm_conversation_cancel_process`.
- Callback runs from a LiteRT-LM-owned background thread → all chunk delivery happens off the main queue. Events are dispatched via `sendEvent` which Expo serializes internally.

### Lifecycle / memory
- One `StreamContext` per request, retained with `Unmanaged.passRetained` for the duration of the C stream.
- Trampoline releases the retain on `is_final` or non-empty `error_msg`. If `send_message_stream` returns non-zero rc, the start path releases the retain immediately.
- `activeStreams` dict (serialized by `streamsQueue`) lets the cancel path look up the live conversation pointer by `requestId`.

### Cancel semantics
- `cancelInferText(requestId)` sets `ctx.cancelled = true` and calls `litert_lm_conversation_cancel_process`. The engine then emits a final frame, the trampoline fires once more, and the regular cleanup path runs.
- The Done event carries `cancelled: true` so the web side can distinguish cancellation from completion.
- **NEEDS REVIEW** — `AI_INFER_DONE.finishReason` is currently set to `'error'` when cancelled (to preserve the existing 4-variant enum). Cleaner: extend `finishReason` with `'cancelled'`.

### Streaming forwarder mounted on WebView
- `installStreamForwarder(sendToWeb)` registers three native event listeners (`onInferStreamToken/Done/Error`) once per WebView mount and translates each to the web `AI_INFER_TOKEN/DONE/ERROR` message family.
- `AI_INFER_DONE.fullText` is sent as `''` — the web side accumulates deltas itself (`inference.ts`); duplicating that buffer on the native side would be wasteful.

## Files touched (cumulative)

- `apps/web/src/components/layout/header.tsx` — desc → ReactNode branching
- `apps/web/src/components/word/words-list-toggle.tsx` — NEW segmented control
- `apps/web/src/app/(app)/words/page.tsx` — replaced `desc` count with toggle
- `apps/web/src/app/(app)/mastered/page.tsx` — same
- `apps/web/src/app/globals.css` — View Transitions keyframes
- `apps/web/src/components/ai/assistant-button.tsx` — NEW reusable per-page AI entry
- `apps/web/src/app/(app)/words/[id]/page.tsx` — header AI button
- `apps/web/src/app/(app)/wordbooks/[id]/page.tsx` — header AI button
- `apps/web/src/app/(app)/quiz/page.tsx` — rating-gated AI button + lastRating/quizSessionId state
- `apps/web/src/lib/i18n/types.ts|ko.ts|en.ts` — `quiz.assistantUnavailableYet`
- `apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift` — streaming + cancel + StreamContext + trampoline
- `apps/mobile/modules/nivoca-ai/src/NivocaAi.types.ts` — stream payload types + events
- `apps/mobile/modules/nivoca-ai/src/NivocaAiModule.ts|.web.ts` — inferTextStream/cancelInferText signatures + web stubs
- `apps/mobile/src/lib/ai/stream-bridge.ts` — NEW native-event→web-bridge forwarder
- `apps/mobile/src/components/webview/app-webview.tsx` — wire AI_INFER/AI_INFER_CANCEL + forwarder lifecycle
- `apps/web/src/components/layout/header.tsx` — desc prop accepts ReactNode (already done in 1H, noted here for completeness)
- `apps/web/src/lib/ai/chat/parser.test.ts` — NEW (12 tests)
- `apps/web/src/lib/ai/chat/tools.test.ts` — NEW (11 tests)
- `apps/web/src/lib/ai/chat/store.test.ts` — NEW (14 tests)
- `apps/web/src/components/quiz/base-flashcard.tsx` — `onRevealedChange` callback
- `apps/web/src/components/quiz/flashcard.tsx` — pass-through `onRevealedChange`
- `apps/web/src/components/quiz/example-quiz-card.tsx` — `onPhaseChange` callback
- `apps/web/src/app/(app)/quiz/page.tsx` — `cardGateOpen` state, visibility-only AI button, dropped `lastRating`
