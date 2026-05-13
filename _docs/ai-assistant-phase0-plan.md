# AI Assistant — Phase 0 (PoC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify that Gemma 4 E2B int4 (running through the existing patched LiteRT-LM v0.11.0 iOS XCFramework) can perform reliable function calling for a small vocabulary CRUD catalog, and that the necessary native API surface (text-only inference, tool injection in chat template) can be implemented without regressing OCR.

**Architecture:** Add a blocking `inferText(messages, tools)` Swift function alongside the existing OCR `infer(prompt, imagePath)`. Extend `SimpleFormatMessages` to inject tools and handle multi-block content. Drive a scenario catalog from a TypeScript test harness, **run on iOS Simulator first** for accuracy scoring, defer device-only validation (latency sanity, OCR regression) to a separate session.

**Tech Stack:** Swift (Expo Module), LiteRT-LM C API v0.11.0 (vendored), React Native (Bare workflow, Expo 55), TypeScript.

**Spec reference:** `_docs/ai-assistant-and-footer-redesign.md` Phase 0 section + Open Items.

---

## Execution Strategy

**Simulator-first** — model output is engine+sampler-determined, not hardware-determined. Same Gemma 4 weights + same TopP sampler -> same answers in simulator and device. We run accuracy/parse/multi-call scoring on simulator (faster iteration, agent-autonomous), and defer real-iPhone timing + OCR regression to a separate session.

**Active scope (this plan):**
- Task 0.0 – XCFramework simulator-slice check
- Task 0.1 – C API streaming inspection
- Task 0.2 – Swift `inferText` blocking variant
- Task 0.3 – Extend `SimpleFormatMessages` + rebuild XCFramework (both slices)
- Task 0.4 – TS wrapper
- Task 0.5 – Scenario catalog
- Task 0.6 – Runner + debug screen
- Task 0.7 – Run on Simulator x3, capture outputs
- Task 0.9 – Go/no-go (partial — accuracy criteria only)

**Deferred to separate session (lowest priority):**
- Task 0.7b – Device latency sanity (1 run on iPhone 15 Pro for warm/cold timing)
- Task 0.8 – OCR regression check (device or simulator)
- Task 0.9b – Final go/no-go combining accuracy + device latency
- Task 0.10 – PoC scaffolding cleanup

---

## Pass/Fail Gate (re-state)

Phase 1 may begin only if all of the following hold:

**Simulator-measurable (this session):**
- True positive >= 9/10
- False positive <= 1/10
- Multi-action prompts emit all related tool_calls in the same assistant turn >= 8/10
- JSON args parse rate >= 95%

**Device-measurable (deferred):**
- Mean text-only inference <= 15s on iPhone 15 Pro warm
- OCR scenarios unaffected on device

---

## File Structure

| File | Role | Action |
|---|---|---|
| `apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift` | Existing OCR module — extend with `inferText` | Modify |
| `apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/` | Vendored framework — verify simulator slice present | Inspect / Rebuild |
| `apps/mobile/src/types/bridge.ts` | Mirror native API types into TS | Modify |
| `apps/mobile/src/lib/ai/inference-text.ts` | New TS wrapper for text inference | Create |
| `apps/mobile/scripts/poc-tool-calling.ts` | Scenario runner + scorer | Create |
| `apps/mobile/scripts/poc-scenarios.ts` | Pure-data scenario catalog | Create |
| `apps/mobile/src/app/_debug-poc.tsx` | Dev-only screen to drive runner | Create |
| `_docs/ai-chat-poc-results.md` | Run results + go/no-go | Create |

No DB, no UI changes in Phase 0.

---

## Task 0.0 — Verify XCFramework has simulator slice

**Files:**
- Inspect: `apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/Info.plist`

**Goal:** Determine whether the current patched v0.11.0 XCFramework includes a simulator slice (`ios-arm64-simulator`). If absent, Task 0.3 must build that slice and re-package; if present, Task 0.3 only rebuilds device + simulator together after the SimpleFormatMessages patch.

- [ ] **Step 1: Inspect XCFramework structure**

Run:
```
ls apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/
plutil -p apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework/Info.plist
```

Expected: a `Info.plist` listing `AvailableLibraries` with `SupportedPlatform`/`SupportedPlatformVariant` entries. Look for both `ios` (device) and `ios` with `simulator` variant.

- [ ] **Step 2: Record finding**

In `_docs/ai-chat-poc-results.md`, add:

```
## XCFramework Audit (Task 0.0)

- Device slice present: yes / no
- Simulator slice present: yes / no
- Action: <none / rebuild simulator slice in Task 0.3>
```

- [ ] **Step 3: Commit**

```
git add _docs/ai-chat-poc-results.md
git commit -m "docs(ai): XCFramework slice audit for PoC simulator path"
```

---

## Task 0.1 — Header inspection: confirm v0.11.0 C API streaming function

**Files:**
- Read: `/tmp/rn-litert-lm-build/.litert-lm-build/LiteRT-LM/c/*.h`

**Goal:** Identify whether `litert_lm_conversation_send_message_streaming` (or similar) exists. If absent, record "no streaming variant — Phase 1 uses chunked polling or token-callback patch".

- [ ] **Step 1: Verify the LiteRT-LM build dir still exists**

```
ls -la /tmp/rn-litert-lm-build/.litert-lm-build/LiteRT-LM/c/ 2>&1 | head -20
```

If missing: re-clone per the journey doc's bazel build command before continuing.

- [ ] **Step 2: List candidate headers**

```
fd -e h -e hpp . /tmp/rn-litert-lm-build/.litert-lm-build/LiteRT-LM/c
```

- [ ] **Step 3: Search for streaming symbols**

```
rg -n 'streaming|callback|on_token|token_cb|stream_message' /tmp/rn-litert-lm-build/.litert-lm-build/LiteRT-LM/c/
```

- [ ] **Step 4: Append to results doc**

```
## C API Streaming Inspection (Task 0.1)

- Headers checked: <list>
- Streaming function: <exact name or "not present">
- Callback signature: <code block or "n/a">
- Phase 1 streaming plan: <use API / use chunked polling / patch upstream>
```

- [ ] **Step 5: Commit**

```
git add _docs/ai-chat-poc-results.md
git commit -m "docs(ai): C API streaming inspection"
```

---

## Task 0.2 — Add `inferText` Swift function (blocking, no streaming)

**Files:**
- Modify: `apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift`

**Goal:** Add an `inferText(requestJson: String) -> String` AsyncFunction taking JSON-encoded `{ messages, tools, options }` and running blocking inference through the existing engine cache. OCR `infer(prompt, imagePath)` is untouched.

- [ ] **Step 1: Define the Decodable request struct**

Before the `definition()` body, add `TextInferRequest` (Decodable):
- `messages: [Message]` with `Message.role: String`, `Message.content: [ContentBlock]`
- `ContentBlock.type: String` plus optional `text`, `path`, `toolName`, `toolCallId`, `result: NivocaJSONValue?`
- `tools: [ToolDef]?` with `name`, `description: String`, `parameters: NivocaJSONValue`
- `options: Options?` with `maxOutputTokens: Int?`, `temperature: Double?`

Add `NivocaJSONValue` (indirect enum Decodable) covering string/number/bool/null/array/object via singleValueContainer. Name avoids collision with framework `JSONValue`.

- [ ] **Step 2: Add `inferText` AsyncFunction**

Inside `definition()` after the existing OCR `infer` block, register:

```
AsyncFunction("inferText") { (requestJson: String) -> String in
  return try self.runTextInference(requestJson: requestJson)
}
```

- [ ] **Step 3: Implement `runTextInference`**

Method order:
1. UTF-8-decode `requestJson` to `Data`; throw `NivocaAiError("bad_request", ...)` on failure
2. JSONDecoder decode into `TextInferRequest` with error wrap
3. `try ensureLoaded()` — reuses existing lazy engine init
4. Guard `engine` + `convConfig` non-nil; throw `not_ready` otherwise
5. Build conversation payload — serialize `{ "messages": [...], "tools": [...] }` via `JSONSerialization` (re-use the existing pattern from `buildImageMessageJson`). Use `JSONEncoder` on `TextInferRequest` would also work if we keep the wire shape stable.
6. `litert_lm_conversation_create(engine, convConfig)`; `defer { litert_lm_conversation_delete(conversation) }`
7. `payload.withCString { cstr in litert_lm_conversation_send_message(conversation, cstr, nil) }`; measure elapsed via `Date()`
8. Guard non-nil response; defer `litert_lm_json_response_delete`
9. Read `litert_lm_json_response_get_string(response)` -> `String(cString:)` (existing helper)
10. Return `extractTextFromResponse(rawJson)` (existing method on the module)

The conversation API will see `tools` in the message JSON; SimpleFormatMessages in Task 0.3 reads that top-level field.

- [ ] **Step 4: Build and verify compilation**

```
cd apps/mobile && bun run prebuild --platform ios
cd ios && pod install
```

Expected: no errors.

- [ ] **Step 5: Run OCR scan once (post-build sanity)**

Build to simulator and run `/words/scan` with a known image. Verify the existing OCR path still works.

- [ ] **Step 6: Commit**

```
git add apps/mobile/modules/nivoca-ai/ios/NivocaAiModule.swift
git commit -m "feat(ai): add blocking inferText Swift function for PoC"
```

---

## Task 0.3 — Extend `SimpleFormatMessages` + rebuild XCFramework (both slices)

**Files:**
- Modify: `/tmp/rn-litert-lm-build/.litert-lm-build/LiteRT-LM/runtime/components/prompt_template.cc`
- Modify: each call site of the existing `SimpleFormatMessages`
- Rebuild: XCFramework with BOTH device + simulator slices

- [ ] **Step 1: Locate SimpleFormatMessages**

```
rg -n 'SimpleFormatMessages' /tmp/rn-litert-lm-build/.litert-lm-build/LiteRT-LM/
```

Note the file path. Existing impl is in spec section 5 (journey doc).

- [ ] **Step 2: Extend the function**

Behavior contract:
1. Signature takes extra `const json& tools` immediately after `messages`
2. After `bos_token`, if `tools` non-null and non-empty:
   - Emit `<start_of_turn>system\n`
   - Static instruction: `You have access to these tools:\n`
   - `tools.dump(2)` pretty-printed
   - Tool-call format hint: `Call a tool by emitting: <tool_call>{"name":"...","arguments":{...}}</tool_call>\n`
   - Multi-call instruction: `When multiple related actions are requested, emit all calls in the same turn.\n`
   - `<end_of_turn>\n`
3. Iterate messages — content array branch handles three block types:
   - `text` -> append text
   - `image` -> append `\n\n<start_of_image>`
   - `tool_result` -> append `\n[tool_result <toolName>]\n` + `block["result"].dump()`
4. Finalize with existing `if (add_generation_prompt) result += "<start_of_turn>model\n"`

Critical: do NOT change behavior when `tools` is null and content is a single image block — that exact shape is the OCR path and must remain bit-identical.

- [ ] **Step 3: Update call sites**

```
rg -n 'SimpleFormatMessages\(' /tmp/rn-litert-lm-build/.litert-lm-build/LiteRT-LM/
```

For OCR-only sites: pass `json(nullptr)`.

For the chat conversation path: trace where the conversation API receives the tools list. If session/conversation config does not surface `tools`, read it from the message JSON payload's top-level `tools` field instead.

- [ ] **Step 4: Rebuild for device**

```
cd /tmp/rn-litert-lm-build/.litert-lm-build/LiteRT-LM
bazel build //c:engine --apple_platform_type=ios --ios_multi_cpus=arm64 --config=ios_arm64
```

- [ ] **Step 5: Rebuild for simulator**

```
bazel build //c:engine --apple_platform_type=ios --ios_multi_cpus=sim_arm64 --config=ios_sim_arm64
```

Note: simulator config name varies by Bazel version. Try `--ios_sim_device=...` or check hung-yueh's build harness for the exact incantation. If neither works, run `bazel query 'attr(name, ".*sim.*", //...)'` to find the right alias.

- [ ] **Step 6: Re-package XCFramework**

```
xcodebuild -create-xcframework \
  -library <device_static_archive> -headers <headers_dir> \
  -library <simulator_static_archive> -headers <headers_dir> \
  -output apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework
```

- [ ] **Step 7: Verify OCR still works (simulator)**

Rebuild the Expo dev client, run `/words/scan` flow with a known image in the simulator. Words must still extract correctly.

- [ ] **Step 8: Commit**

```
git add apps/mobile/modules/nivoca-ai/ios/Frameworks/LiteRTLM.xcframework
git commit -m "feat(ai): extend SimpleFormatMessages with tool injection + content blocks; rebuild XCFramework with device+simulator slices"
```

Also append the patch diff summary to `_docs/blog-gemma4-ios-litert-journey.md` Code change locations.

---

## Task 0.4 — TS wrapper for text inference

**Files:**
- Modify: `apps/mobile/src/types/bridge.ts`
- Create: `apps/mobile/src/lib/ai/inference-text.ts`
- Modify: `apps/mobile/modules/nivoca-ai/index.ts`

- [ ] **Step 1: Add types to `bridge.ts`**

Append exports:
- `AiTextMessage` = `{ role: 'user' | 'assistant' | 'system' | 'tool'; content: AiContentBlock[] }`
- `AiContentBlock` discriminated union: text / image / tool_result variants
- `AiToolDef` = `{ name; description; parameters: Record<string, unknown> }`
- `AiTextInferRequest` = `{ messages; tools?; options? }`

- [ ] **Step 2: Create the wrapper**

`apps/mobile/src/lib/ai/inference-text.ts`:
- Import `NivocaAi` from `../../../modules/nivoca-ai`
- Import `AiTextInferRequest` from `../../types/bridge`
- Export `async function runTextInference(request: AiTextInferRequest): Promise<string>`:
  - `JSON.stringify(request)` -> `requestJson`
  - Log start with messages.length, tools?.length
  - `await NivocaAi.inferText(requestJson)`
  - Log duration, raw.length
  - Return raw

No parsing — PoC consumer parses tool tags itself.

- [ ] **Step 3: Expose `inferText` in module surface**

`apps/mobile/modules/nivoca-ai/index.ts`: add `inferText: (requestJson: string) => Promise<string>` to the module type interface. If types are auto-derived via `requireNativeModule<...>`, declare an explicit interface.

- [ ] **Step 4: Smoke test in simulator**

Temporary button calling `runTextInference({ messages: [{ role:'user', content:[{type:'text',text:'Say hello in Japanese.'}] }] })`. Run on simulator, confirm engine boots and returns text.

- [ ] **Step 5: Remove the smoke button**

PoC scenarios will drive inference from Task 0.6.

- [ ] **Step 6: Commit**

```
git add apps/mobile/src/types/bridge.ts apps/mobile/src/lib/ai/inference-text.ts apps/mobile/modules/nivoca-ai/index.ts
git commit -m "feat(ai): add TS wrapper for blocking text inference (PoC)"
```

---

## Task 0.5 — PoC scenario catalog

**Files:**
- Create: `apps/mobile/scripts/poc-scenarios.ts`

- [ ] **Step 1: Define and export `PocScenario` + `SCENARIOS`**

`PocScenario` fields: `id: string`, `ask: string`, optional `expectTool: string`, `expectMultiToolMinCount: number`, `expectNoTool: boolean`, `expectClarification: boolean`, `context: string`.

10 scenarios:
1. `tp-add-word` — ask: 「桜」を単語として追加して。読みは「さくら」、意味は「벚꽃」 — expectTool: `add_word`
2. `tp-delete-word` — ask: 「桜」 삭제해줘 — expectTool: `delete_word` — context: CURRENT WORD id w-1
3. `tp-create-wordbook` — ask: 단어장 「일본 봄」 만들어줘 — expectTool: `create_wordbook`
4. `tp-add-to-wordbook` — ask: 寿司를 「일식」 단어장에 추가해줘 — expectTool: `add_word_to_wordbook` — context: WORDBOOK id wb-1
5. `tp-set-mastered` — ask: 「桜」 암기완료로 표시해줘 — expectTool: `set_mastered` — context: CURRENT WORD
6. `multi-add-batch` — ask: 봄 단어 다섯개 추천하고 「일본 봄」 단어장에 추가해줘 — expectMultiToolMinCount: 5 — context: WORDBOOK
7. `fp-explain-word` — ask: 「桜」 어떻게 읽어? — expectNoTool: true
8. `fp-meta-comment` — ask: 나는 단어 외우는 게 너무 어려워 — expectNoTool: true
9. `amb-delete-no-target` — ask: 이거 빼줘 — expectClarification: true
10. `read-search` — ask: 내 단어 중에 「桜」 있어? — expectTool: `search_words`

- [ ] **Step 2: Commit**

```
git add apps/mobile/scripts/poc-scenarios.ts
git commit -m "test(ai): add PoC scenario catalog (10 scenarios)"
```

---

## Task 0.6 — PoC runner script + debug screen

**Files:**
- Create: `apps/mobile/scripts/poc-tool-calling.ts`
- Create: `apps/mobile/src/app/_debug-poc.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`

- [ ] **Step 1: Declare TOOL_CATALOG**

In `poc-tool-calling.ts`, declare `TOOL_CATALOG: AiToolDef[]` with all 10 tools from spec's Function Catalog: add_word / edit_word / delete_word / set_mastered / create_wordbook / edit_wordbook / delete_wordbook / add_word_to_wordbook / remove_word_from_wordbook / search_words. Use the JSON Schema shapes from the spec verbatim.

- [ ] **Step 2: Implement `extractToolCalls`**

Function `extractToolCalls(raw: string): ToolCallExtract[]`:
- Global regex: `<tool_call>([\s\S]*?)<\/tool_call>`
- For each match: trim body, try `JSON.parse`, set `parseOk = typeof obj.name === 'string'`
- Return `{ name, argsRaw, argsParsed, parseOk }[]`

- [ ] **Step 3: Implement scorer**

`score(scn, calls): { passed; reason? }`:
- `expectNoTool`: pass iff `calls.length === 0`
- `expectClarification`: pass iff `calls.length === 0`
- `expectMultiToolMinCount`: pass iff `calls.length >= n`
- `expectTool`: pass iff `calls.length === 1 && calls[0].name === expectTool && calls[0].parseOk`

- [ ] **Step 4: Implement runner**

`runPoc()`: loop over `SCENARIOS`, build `systemContent` (fixed preamble + scenario.context), call `runTextInference({ messages: [system, user], tools: TOOL_CATALOG })`, catch errors, score, push results. Aggregate `Summary` with totals + per-category pass rates + mean duration + parse rate.

- [ ] **Step 5: Implement formatter**

`formatReport(summary, results)`: human-readable lines for totals + per-scenario PASS/FAIL with duration + failure reason.

- [ ] **Step 6: Create debug screen**

`_debug-poc.tsx` — `ScrollView` + `Button` + monospace `Text`. On press: `runPoc()`, set report state, log a `PoC FULL DUMP` line with full JSON.

- [ ] **Step 7: Register dev-only route**

In `_layout.tsx`, wrap `<Stack.Screen name="_debug-poc" />` in `__DEV__`.

- [ ] **Step 8: Commit**

```
git add apps/mobile/scripts/poc-tool-calling.ts apps/mobile/src/app/_debug-poc.tsx apps/mobile/src/app/_layout.tsx
git commit -m "test(ai): PoC runner + debug screen"
```

---

## Task 0.7 — Run PoC on iOS Simulator x3

**Files:**
- Create: `_docs/ai-chat-poc-results-raw.json`, `-raw-run2.json`, `-raw-run3.json`
- Modify: `_docs/ai-chat-poc-results.md`

- [ ] **Step 1: Boot simulator + dev client**

```
cd apps/mobile && bun run ios
```

(No `--device` flag — runs on default simulator. iPhone 15 simulator preferred for closeness to target device.)

- [ ] **Step 2: Open debug screen, tap Start**

Watch console (Metro / simulator log). Total ~2 minutes plus cold start (simulator cold start is faster than device — likely 20–30s on M1 Pro).

- [ ] **Step 3: Save console dump as raw JSON**

Save the `PoC FULL DUMP` line content as `_docs/ai-chat-poc-results-raw.json`.

- [ ] **Step 4: Re-run twice for variance**

Save as `-raw-run2.json` and `-raw-run3.json`. Variance from temp=0.7 sampling matters.

- [ ] **Step 5: Append summary table to results doc**

Add a Scenario Runs section with:
- Per-scenario PASS/FAIL x 3 runs table
- Timing: cold (simulator), mean warm, p95 warm — annotate `[SIMULATOR]` since device numbers are deferred
- Tool-call token format observed (tag form, args key name, parse failures)
- Multi-call behavior

- [ ] **Step 6: Commit**

```
git add _docs/ai-chat-poc-results-raw.json _docs/ai-chat-poc-results-raw-run2.json _docs/ai-chat-poc-results-raw-run3.json _docs/ai-chat-poc-results.md
git commit -m "test(ai): record PoC scenario runs on iOS Simulator"
```

---

## Task 0.9 — Go/no-go decision (accuracy criteria only)

**Files:**
- Modify: `_docs/ai-chat-poc-results.md`
- Modify: `_docs/ai-assistant-and-footer-redesign.md`

**Note:** This decision uses simulator-only data. Device latency + OCR regression are evaluated in a separate session (Task 0.7b + Task 0.8 + Task 0.9b). Phase 1 implementation can start in parallel with those validations as long as the simulator accuracy gate passes here.

- [ ] **Step 1: Compute pass rates from 3 simulator runs**

A scenario "passes the gate" if it passed in >=2 of 3 runs. Apply:
- True positive: pass / expectTool >= 0.9
- False positive: total false positives across all scenarios <= 1/10
- Multi-call batching: >= 0.8 of expectMultiToolMinCount scenarios
- Parse rate >= 0.95

- [ ] **Step 2: Write Decision (accuracy-only) section**

Append to `_docs/ai-chat-poc-results.md`:

```
## Decision — Accuracy (Task 0.9)

> Status: ACCURACY-GO | ACCURACY-NO-GO | CONDITIONAL
> Note: Device latency + OCR regression deferred to a separate session.
> Phase 1 implementation may begin in parallel if this gate is ACCURACY-GO.

### Criteria
| Criterion | Threshold | Measured (Simulator) | Pass |
|---|---|---|---|
| True positive | >= 9/10 | <X/10> | ✓ / ✗ |
| False positive | <= 1/10 | <X/10> | ✓ / ✗ |
| Multi-call batched | >= 8/10 | <X/10> | ✓ / ✗ |
| JSON parse rate | >= 95% | <X%> | ✓ / ✗ |

### Findings affecting Phase 1
- Tool-call token format: <confirmed / variant — Phase 1 parser must accept ...>
- Streaming API: <available / fallback ...>
- Multi-call behavior: <tendency observed>
- Notable failure modes: <list>

### Next actions
- If ACCURACY-GO: schedule device session for 0.7b + 0.8 + 0.9b; start Phase 1 plan
- If ACCURACY-NO-GO: <remediations: prompt boost, E4B, thinking mode, constrained decoding>
- If CONDITIONAL: <additional tasks>
```

- [ ] **Step 3: If ACCURACY-GO, update spec status**

Edit `_docs/ai-assistant-and-footer-redesign.md`, tick Phase 0 simulator-scope items, update header Status to `In Progress (Phase 0 partial — device validation pending)`.

- [ ] **Step 4: Commit**

```
git add _docs/ai-chat-poc-results.md _docs/ai-assistant-and-footer-redesign.md
git commit -m "docs(ai): Phase 0 simulator accuracy gate decision"
```

---

## Deferred to Separate Session (Lowest Priority)

These tasks require a physical iPhone 15 Pro. They run independently of Phase 1 implementation as long as Task 0.9 returned ACCURACY-GO.

### Task 0.7b — Device latency sanity run

- 1 run on iPhone 15 Pro to measure cold start + warm latency
- Verify accuracy is consistent with simulator results (same scenarios)
- Record in `_docs/ai-chat-poc-results.md` "Device Latency Sanity" section

### Task 0.8 — OCR regression check on device

- Open `/words/scan`, run a reference image
- Compare word count + first 5 words + total time against journey-doc baseline
- Record in `_docs/ai-chat-poc-results.md` "OCR Regression" section

### Task 0.9b — Final go/no-go

- Combine simulator accuracy + device latency + OCR regression
- Apply remaining gate criteria: mean warm <= 15s, OCR unchanged
- Update spec status to `In Progress (Phase 0 complete)` if all pass

### Task 0.10 — PoC scaffolding cleanup

- Delete `_debug-poc.tsx`, remove the dev-only route entry
- Keep `inference-text.ts` and scenarios — they become Phase 1 fixtures

---

## Self-Review

**Spec coverage:** Each Phase 0 checklist item in the spec is mapped to a task here, with the simulator-vs-device split clearly annotated.

**Placeholder scan:** Code listings that would otherwise contain shell-call patterns are described as structural steps (Decodable fields, method body order) rather than raw code blocks. Each step still gives the engineer the exact contract to implement; the existing `runInference` in `NivocaAiModule.swift` plus the structural notes here are sufficient for deterministic implementation.

**Type consistency:**
- `AiTextMessage`, `AiContentBlock`, `AiToolDef`, `AiTextInferRequest` defined in 0.4, consumed in 0.5/0.6
- `PocScenario` defined in 0.5, consumed in 0.6
- Swift `TextInferRequest` + `NivocaJSONValue` internal to the module
- `runTextInference(request)` signature in 0.4 matches the call in 0.6

**Findings the engineer should know in advance:**
- Task 0.3 patches files outside the repo (LiteRT-LM build dir). If cleaned, re-clone + re-apply the existing 4 patches per the journey doc Code change locations table before continuing.
- XCFramework simulator slice: if Task 0.0 finds it missing, Task 0.3's `bazel build` step explicitly adds it (the simulator config flag name may need adjustment per Bazel version — note included).
- Tasks 0.7b / 0.8 / 0.9b require a physical iPhone — agent prepares commits and updates docs; operator drives the device.

---

## Execution Handoff

Plan saved to `_docs/ai-assistant-phase0-plan.md`. The Active scope (Tasks 0.0 – 0.9 minus the deferred ones) can be executed agent-autonomously up to Task 0.7 — only the simulator boot/run is interactive but scriptable.

Execution options:
1. **Subagent-Driven** — fresh subagent per task, review between. Best for the Bazel rebuild loop in 0.3.
2. **Inline Execution** — batch with checkpoints. Fast for 0.0/0.1/0.2/0.4/0.5/0.6 (pure code edits).
3. **Mixed** — inline for the code-edit tasks, subagent for 0.3 (Bazel rebuild) and 0.7 (simulator runs).
