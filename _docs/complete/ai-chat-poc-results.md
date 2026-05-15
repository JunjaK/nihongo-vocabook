# AI Chat PoC Results

> Status: **In Progress** — Phase 0 simulator path
> Started: 2026-05-14
> Spec: [ai-assistant-and-footer-redesign.md](./ai-assistant-and-footer-redesign.md)
> Plan: [ai-assistant-phase0-plan.md](./ai-assistant-phase0-plan.md)

---

## XCFramework Audit (Task 0.0)

**Path:** `apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/`

**Slices present (from Info.plist `AvailableLibraries`):**

| LibraryIdentifier | SupportedPlatform | Variant | Architectures |
|---|---|---|---|
| `ios-arm64` | ios | (device) | arm64 |
| `ios-arm64-simulator` | ios | simulator | arm64 |

**Action:** None. Existing XCFramework already supports the simulator-first PoC path. Task 0.3 still needs to rebuild (after the SimpleFormatMessages patch) but with **both** slices in the same bazel cycle — no extra slice-build step.

---

## C API Streaming Inspection (Task 0.1)

**Header:** `/tmp/rn-litert-lm-build/.litert-lm-build/LiteRT-LM/c/engine.h`
**LiteRT-LM version:** v0.11.0 (patched by us; see journey doc)

### Discovered surface

| Symbol | Purpose | Phase 1 usage |
|---|---|---|
| `LiteRtLmStreamCallback` (typedef) | `(void* callback_data, const char* chunk, bool is_final, const char* error_msg) -> void` | Bridge token deltas to Swift event emitter |
| `litert_lm_conversation_send_message_stream(conv, message_json, extra_context, callback, callback_data) -> int` | Non-blocking streaming variant of `send_message` | Drive token-by-token chat streaming |
| `litert_lm_conversation_cancel_process(conv) -> void` | Cancel an in-flight async inference | Wire to `AI_INFER_CANCEL` bridge message |
| `litert_lm_session_run_decode_async` | Session-level streaming variant (lower-level) | Not used (conversation API is the right level) |
| `litert_lm_session_generate_content_stream` | Multimodal session-level streaming | Not used (conversation API handles multimodal) |

### Callback semantics

- `chunk`: pointer-valid only for the duration of the call. Must be copied if forwarded to another thread.
- `is_final = true`: indicates last chunk; `chunk` may still contain trailing text (verify in PoC).
- `error_msg != NULL`: error stream; rendering should display error rather than continue accumulating.
- Invoked from a background thread (per header comment).

### Phase 1 streaming plan

- Swift bridge: register a `LiteRtLmStreamCallback` that dispatches to the Swift event emitter with `onInferToken { requestId, delta }`. On `is_final`, emit `onInferDone`. On `error_msg`, emit `onInferError`.
- Cancellation: store the active conversation pointer keyed by `requestId`; `AI_INFER_CANCEL` calls `litert_lm_conversation_cancel_process(conv)`.
- No upstream patching required.

**Risk R3 (streaming API uncertainty) — resolved.**

---

## Scenario Runs (Task 0.7)

> Not yet executed. Pending Tasks 0.2 – 0.6 completion + simulator boot.

---

## Decision — Accuracy (Task 0.9)

> Not yet decided. Pending Task 0.7 results.

---

## Deferred (Separate Session)

- **Task 0.7b** — device latency sanity (1 run on iPhone 15 Pro)
- **Task 0.8** — OCR regression check
- **Task 0.9b** — final go/no-go combining accuracy + device timing
- **Task 0.10** — PoC scaffolding cleanup
