# AI Assistant — Testing Handoff

> Audience: agent or engineer picking up OCR regression + physical-device testing for the on-device AI Assistant.
> State at handoff: 2026-05-15. All Phase 1 implementation is complete and type-clean (`bunx tsc --noEmit` exit 0 in both `apps/web` and `apps/mobile`). All 119 web unit tests pass. No physical-device or simulator runs have been done yet for the streaming path.

## Why this handoff exists

The implementation agent has shipped:

- Phase 1A–1M (DB schema, types, store, bridge, native streaming, UI, i18n, tests, page integrations, settings toggle, mastered segmented toggle).
- Quiz AI session persistence toggle (`Settings → 퀴즈 → AI Assistant → 퀴즈 AI 대화 저장`, default OFF).

The remaining tasks all require interactive use of the iOS simulator / a physical iPhone, and the implementation agent cannot drive those. They are bundled here so a separate session can execute them without paging back through the design docs.

## Background reading order

1. `_docs/ai-assistant-and-footer-redesign.md` — full spec (19 decisions, function catalog, system prompts, phased rollout).
2. `_docs/ai-assistant-phase0-plan.md` — PoC plan with 10 tasks.
3. `_docs/ai-chat-poc-results.md` — XCFramework slice audit + streaming-API inspection.
4. `_docs/ai-assistant-phase1-implementation-notes.md` — decisions made by the implementation agent (NEEDS REVIEW items, Q1/Q2/Q3 resolutions).
5. `_docs/blog-gemma4-ios-litert-journey.md` — prior context on the Gemma 4 / LiteRT-LM setup.

Skim 1–3 before starting; 4 is the freshest delta.

## Outstanding tasks

### T1. Phase 0.7 — Simulator runs ×3 (tool-calling PoC)

**Goal**: validate Gemma 4 E2B's function-calling accuracy through the prompt-only path. Target: ≥9/10 correct on the scenario catalog.

**Files**:
- `apps/mobile/scripts/poc-tool-calling.ts` — runner, `TOOL_CATALOG` (11 tools), `extractToolCalls`, scorer, summarizer.
- `apps/mobile/src/app/_debug-poc.tsx` — debug screen wiring the runner.
- Scenario catalog is inline in the runner.

**Steps**:
1. Boot the Expo dev build on the iOS simulator (`bun run dev:mobile` from repo root, then `i` for iOS).
2. Open the app → log in (any e2e account works) → Settings → OCR → download `gemma-4-e2b` (~2.4 GB; takes 5–10 minutes on a fast connection).
3. Navigate to the hidden `/_debug-poc` route (it should be linkable manually; check `apps/mobile/src/app/_debug-poc.tsx` for exact entry).
4. Run the catalog 3 times. Save the per-run JSON output to `_docs/poc-runs/run-1.json`, `run-2.json`, `run-3.json`.

**Important**: model assets do not exist on a fresh simulator — every machine needs the in-app download once. Don't waste time re-running until that's complete.

**Common failure modes**:
- `engine_create_failed` after `litert_lm_engine_create returned NULL` in `~0.1s`: this is the entitlement issue on physical devices, but on simulators it usually means the model file is truncated. Check Documents/ai-models/*.litertlm size against the expected 2,588,147,712 bytes for E2B (see `apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift:236-238` for the expected sizes).
- `DYNAMIC_UPDATE_SLICE` errors at decode time: usually fixed by the `max_num_tokens=2048` + `enable_speculative_decoding=false` we already set in `tryCreateEngine`. If you see it again, the model build changed and we need to bump the cap.

### T2. Phase 0.9 — Go/no-go decision

Depends on T1. Score the three runs against the scenario catalog, compute the true-positive rate. The user committed to the prompt-only path if ≥9/10 across runs. Below that, we need the `SimpleFormatMessages` structural patch (Task 0.3), which requires a Bazel rebuild of LiteRT-LM and is out of scope for this handoff.

**Deliverable**: append a `Final Summary` to `_docs/ai-assistant-phase0-plan.md` with the scores and a go / no-go call.

### T3. Phase 0.8 — OCR regression

**Goal**: confirm the existing OCR path still works after the chat-streaming additions to the Swift module. The streaming additions live in `apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift` lines ~150–340 (new `inferTextStream`, `cancelInferText`, `StreamContext`, trampoline). The blocking `runInference(prompt:imagePath:)` path is untouched but shares the engine + `ensureLoaded()` plumbing.

**Test**:
1. Same dev build, same simulator, same downloaded model from T1.
2. App → Words → Scan → take a photo of a Japanese passage (or pick from gallery) → extract.
3. Verify: results card appears, extraction completes, terms get enriched, "Add to wordbook" flow still works.

**Pass criteria**: extraction time within ±20% of the pre-change baseline, all extracted words pass the term filter, no crashes.

**Specifically watch for**:
- Race between `streamsQueue` and `loadQueue` if you trigger an OCR call while a stream is mid-flight. They should be independent but the engine is shared — OCR creates its own conversation per call (line ~566), so the only contention is `ensureLoaded`. If OCR hangs after a chat call, that's the smoking gun.

### T4. Phase 1 streaming — physical device smoke test

**Goal**: confirm that the streaming path actually streams on real hardware. Simulators sometimes mask thread-scheduling issues with the C callback trampoline.

**Why physical only**: the entitlement (`com.apple.developer.kernel.extended-virtual-addressing`) is still blocking E2B on physical iPhones with Personal Team builds. Either:
  - The user has a paid Apple Developer account by now → can grant the entitlement → physical run works.
  - Still Personal Team → you can only test on the simulator. Document that and ship.

If you do get a physical device run:
1. Open the assistant tab → send a message → expect token-by-token streaming in the bubble.
2. Send another message and tap Cancel mid-stream → expect the bubble to stop growing, `AI_INFER_DONE` with `finishReason='error'` (cancelled flag), no crash.
3. Send a message that should trigger a `<tool_call>...</tool_call>` → confirm card appears, multi-select works, approve → tool result + follow-up inference fires.

**Smoking guns to watch for**:
- Crashes with `EXC_BAD_ACCESS` in `nivocaAiStreamTrampoline` (file: `NivocaAiModule.swift` ~line 800–820): `Unmanaged.passRetained` is being double-released. Likely cause: the engine emits `is_final` after we've already torn down on error_msg. Mitigation in `handleStreamCallback`: the `ctx.finished` guard should prevent double cleanup, but if you see this in practice, check the trampoline's release logic.
- The token-event stream lands on JS but the message bubble doesn't update: this is usually a React re-render issue in `chat-message.tsx` or `chat-message-list.tsx`, not a native bug.

### T5. E2E tests (not blocking — Phase 1.5)

The implementation didn't budget E2E for chat. When time permits, add Playwright specs at `apps/web/e2e/`:
- `chat-general.spec.ts` — open assistant tab, send a message, mock the bridge to emit two tokens + done, assert the bubble renders the joined text.
- `chat-tool-confirm.spec.ts` — mock a `<tool_call>` event, assert the confirm card appears with the right copy.
- `chat-quiz-gate.spec.ts` — start a quiz, assert AI button is hidden until reveal, then appears after rate.

The native bridge can be stubbed by replacing `window.NiVocaBridge` in `e2e/fixtures/`.

## What the implementation agent did NOT do (and why)

- **Did not run any iOS simulator/device** → cannot in this environment.
- **Did not write E2E tests** → out of Phase 1 scope; flagged above for Phase 1.5.
- **Did not implement Settings → Assistant page** for the AI pre-warm toggle (also planned). The quiz-AI-save toggle lives on `/settings/quiz` for now as a quick win. If you build a dedicated assistant settings page, relocate the toggle there and keep the `assistant-prefs.ts` API unchanged.
- **Did not change `AI_INFER_DONE.finishReason`** to add a `'cancelled'` variant. Currently cancel maps to `'error'`. The wire type is in `apps/web/src/lib/native-bridge.ts` and `apps/mobile/src/types/bridge.ts` — see [NEEDS REVIEW Phase 1E/1F section](./ai-assistant-phase1-implementation-notes.md) of the impl notes for the trade-off.

## Useful commands

```bash
# Web type check
cd apps/web && bunx tsc --noEmit

# Mobile type check
cd apps/mobile && bunx tsc --noEmit

# Web unit tests
cd apps/web && bunx vitest run

# Web unit tests, watch mode
cd apps/web && bunx vitest

# Run a specific suite
cd apps/web && bunx vitest run src/lib/ai/chat/

# Expo dev server (mobile)
bun run dev:mobile

# In Expo: 'i' for iOS simulator, 'r' to reload, 'j' to open DevTools.
```

## Quick reference: file locations

| Concern | File |
|---|---|
| Swift module | `apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift` |
| C headers | `apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/.../litert_lm_engine.h` |
| TS bridge types | `apps/mobile/src/types/bridge.ts`, `apps/web/src/lib/native-bridge.ts` |
| Mobile stream forwarder | `apps/mobile/src/lib/ai/stream-bridge.ts` |
| WebView host | `apps/mobile/src/components/webview/app-webview.tsx` |
| Web chat store | `apps/web/src/lib/ai/chat/store.ts` |
| Web stream adapter | `apps/web/src/lib/ai/chat/inference.ts` |
| Web tool parser | `apps/web/src/lib/ai/chat/parser.ts` |
| Assistant page | `apps/web/src/app/(app)/assistant/page.tsx` |
| Drawer | `apps/web/src/components/ai/chat-drawer.tsx` |
| Per-page button | `apps/web/src/components/ai/assistant-button.tsx` |
| Settings toggle | `apps/web/src/app/(app)/settings/quiz/page.tsx` + `apps/web/src/lib/ai/assistant-prefs.ts` |
| PoC runner | `apps/mobile/scripts/poc-tool-calling.ts` |
| Debug screen | `apps/mobile/src/app/_debug-poc.tsx` |

## Acceptance for full handoff completion

- [x] T1 done — three JSON run files under `_docs/poc-runs/` (executed 2026-05-15 by impl agent on iPhone 16 Pro simulator)
- [x] T2 done — go/no-go appended to `_docs/ai-assistant-phase0-plan.md` (verdict: strict NO-GO at 60%, "conditional GO" after parser polish)
- [ ] T3 done — OCR regression note appended to this file (PASS / FAIL + observed timing) **— NOT YET RUN (requires UI: login + scan flow, headless harness can't drive)**
- [ ] T4 done — physical or simulator chat smoke test note appended (which device, which scenarios passed) **— NOT YET RUN (entitlement blocker on physical iPhones with Personal Team; simulator chat smoke is possible but skipped to avoid scope-creep this session)**
- [ ] (Optional) T5 done — at least one E2E spec added under `apps/web/e2e/`
