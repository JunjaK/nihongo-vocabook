# On-device LLM — Status & Work Log (2026-05-18)

> Status: Active (Snapshot)

Comprehensive snapshot of all on-device LLM work to date — model selection,
iOS native bridge, memory engineering, assistant feature scope, prompt /
tool redesign, security, and the known open items. Use this as the entry
point when picking up the on-device LLM track.

## 1. Model selection & migration (Phase A — complete)

### Web (transformers.js)

- Initial: cloud LLM Vision OCR.
- 1st migration: web-side Gemma 4 E2B via `@huggingface/transformers` v4.1+.
- Limitation: WebGPU required → desktop Chrome / Edge only. Mobile Safari
  out of scope.
- Decision: mobile takes the native route.

### iOS native (LiteRT-LM)

- Google's LiteRT-LM v0.11.0 XCFramework, vendored from the
  hung-yueh/react-native-litert-lm v0.3.6 patched build (which embeds
  Google's prebuilt LiteRT-LM static lib + Metal accelerator dylibs).
- Model: Gemma 4 E2B int4 multimodal (2.58 GB `.litertlm`).
- Anchor commit: `a0b5277` — "on-device Gemma 4 multimodal inference via
  vendored LiteRT-LM".

### Dual-runtime split

- Web desktop → transformers.js Gemma 4 E4B
- iOS app → native Gemma 4 E2B
- Other surfaces (non-desktop web, non-iOS mobile) → cloud fallback
  (currently disabled; deferred to Phase 2 #3).

## 2. Swift module — `NivocaAiModule.swift` (~1200 lines)

| Area | Key points |
|---|---|
| Engine lifecycle | Lazy create, instance cached for JS context lifetime, conversation re-created per-call (cached conversation accumulates history → KV cache overflow). |
| Multimodal | Conversation API only — `session_generate_content` is rejected by the iOS XCFramework's vision executor. Images passed as file paths. |
| MTP (Multi-Token Prediction) | gpu+MTP → gpu → cpu+MTP → cpu fallback chain. |
| Streaming | `litert_lm_conversation_send_message_stream` + Swift `@convention(c)` trampoline + `Unmanaged.passRetained`. |
| Audio | expo-audio integration, m4a passed directly. |
| Engine recovery | `conversation_create == NULL` triggers `teardownEngine` so the next call rebuilds from scratch. |

## 3. iOS memory & entitlements (Phase B — complete)

| Problem | Cause | Resolution |
|---|---|---|
| Immediate crash on launch (mmap-cap) | Personal Team can't mmap a 2.4 GB blob | `com.apple.developer.kernel.extended-virtual-addressing` |
| `INVALID_ARGUMENT 2630 >= 2048` | `max_num_tokens = 2K` too small | Adaptive `pickKVCacheSize()` (2K/4K/8K/16K/32K buckets) |
| Jetsam OOM mid-stream | 32K cache + GPU weights ≈ 2.5 GB working set, exceeds default Jetsam | `increased-memory-limit` (production, Apple approval pending) + `increased-debugging-memory-limit` (debug, no approval needed) |
| Xcode 26.5 link error | `__preview.dylib` implicit-links SwiftUICore, rejected | Local config plugin `with-disable-previews` (sets `ENABLE_PREVIEWS = NO`) |

## 4. Adaptive KV cache (`pickKVCacheSize`)

```swift
let availableBytes = Int(os_proc_available_memory())
let kvBytesPer1K   = 25 * 1024 * 1024            // ≈ 25 MB / 1K-context
let baselineBytes  = Int(1.4 * 1024 * 1024 * 1024) // weights + Metal scratch
let usableForCache = availableBytes - baselineBytes
let maxKContext    = max(2, usableForCache / Int(Double(kvBytesPer1K) * 1.6))
// snap to one of: 32K / 16K / 8K / 4K / 2K
```

Empirical buckets:

- iPhone 17 Pro / debug build + entitlement → 32K
- iPhone 15 / no entitlement → 8K
- Simulator → `os_proc_available_memory() == 0` → 2K fallback

## 5. AI Assistant feature (Phases 1, 1.5, 2 — complete)

### Phase 1 — core chat

- 4 chat scopes: `general` / `word` / `wordbook` / `quiz`.
- Tool catalog (originally 13, later 12 after `find_similar` removal).
- `<tool_call>{...}</tool_call>` stream parser (90% accuracy in PoC).
- Confirmation card UI for every mutating tool (user-gated).

### Phase 1.5 — six features in one batch

- Multi-session UI.
- Message feedback (thumbs up / down).
- Session rename / delete.
- Context auto-summary.
- Telemetry uploader with payload scrubbing.
- Explicit "new chat" action.

### Phase 2 — partial

- ✅ #1 model variant selector (E2B/E4B)
- ✅ #2 prewarm toggle
- ❌ #3 cloud fallback (skipped)
- ✅ #4 quiz session-save toggle
- ✅ #5 placement of the assistant tab (center of bottom nav)

## 6. UI & UX

- React-markdown + remark-gfm in assistant bubbles (commit `4b90f72`).
- Streaming envelope leak bug fix (`4b90f72`): the LiteRT-LM C API streams
  every token wrapped in `{"role":"assistant","content":[{"type":"text",
  "text":"X"}]}`. The web side was rendering those envelopes literally;
  fix extracts the inner text + strips Gemma control tokens (`<end_of_turn>`,
  etc.) with cross-chunk awareness.
- Chat input bar: mic + file attach + text are unified (Claude-style).

## 7. Chat persistence bug fix (`a5e3855`)

**Symptom.** Send messages → close app → reopen → messages gone.

**Root cause.** `RepositoryProvider` constructs `guestRepository` on first
mount (auth still loading). Chat store's `_repo` got pinned to that. Once
auth restored and the provider rebuilt with `SupabaseRepository`, the
chat store stayed on `guestRepository` because of a `hydrated` short-
circuit in `MobileShell`'s init effect.

Every subsequent `appendMessage` called `guestRepository.chat.appendMessage`
which threw `LOGIN_REQUIRED`, was swallowed by the surrounding silent
`try { } catch { }`, and never reached Supabase.

**Fix.** Wait for `authLoading` to resolve, then re-run `initChat` every
time the repo identity changes. The store's `init` now explicitly clears
`generalSession` / `contextSessions` / `pendingConfirms` so an old
in-memory session can't leak across.

**Adjacent.** Twelve silent `try { } catch { }` sites in `store.ts`
gained `devWarn(scope, err)` calls — visible in dev mode only — so the
next stealth regression of this shape surfaces immediately.

## 8. Prompt + tool catalog redesign (this session, 8 commits)

| Phase | Content | Commits |
|---|---|---|
| C1 | Remove `find_similar` marker tool | `70ab3f9` |
| C2 | Scope-filtered catalog (quiz 3 / word 6 / wordbook 4 / general 12), safety-first ordering, description hygiene | `1635264`, `e65b04a` |
| C3 | UUID 8-char shortening + per-session idTable (with collision guard) | `2ef71cc`, `ddc4221` |
| C4 | System prompt redesign: tutor persona, 漢字(かな) mandate, quiz rating-keyed tone (`again` → simple, `easy` → rich) | `c4046eb` |
| C5 | Dynamic token budget (Swift `getEngineInfo` → bridge → `getBudget(kvCache)`), pair-preserving history trim, `edit_word.priority`, alphabetical tools sort | `d6f35aa`, `47bed3a` |

Test status: 75 / 75 chat tests pass, TS clean.

Spec at `_docs/active/2026-05-17-ai-chat-prompt-tool-redesign.md`.
Plan at `_docs/active/2026-05-17-ai-chat-prompt-tool-redesign-plan.md`.

## 9. Security (Pass 1 + Pass 2 — complete)

- PostgREST `.or()` injection guards (`postgrest-safe.ts`).
- CSP / HSTS / X-Frame-Options / Referrer-Policy / Permissions-Policy.
- Image upload size / type / count validation.
- DB error messages no longer leak to the client.
- Rate limiter: UA dropped from bucket key; XFF rightmost entry preferred
  (spoof-resistant).
- `.ipa` purged from git history via `git filter-repo --force-push`.
- Dependency vulnerabilities 73 → 52 (including all the high-severity
  Next.js advisories).
- **All `/api/*` routes now require auth; anonymous rate limiter
  deleted entirely (`eb07840`).**

Pass writeup: `_docs/active/2026-05-17-on-device-llm-status.md` →
`_docs/active/security-pass-2026-05-15.md`.

## 10. Known limitations + next work

### Hallucination (reported by user, 2026-05-17)

- `鯛(たい)` → "열여덟" (should be "도미"), `鰤(たり)` → "어부"
  (should be "방어"). Gemma E2B's Japanese-Korean vocabulary knowledge
  is unreliable for rare nouns (fish, plants, slang).
- **Planned fix (designed, not implemented):** cascade lookup tool.
  - `lookup_word(term)` + `lookup_words_batch(terms[])`.
  - Server-side cascade per term: user's `words` → `dictionary_entries`
    → `kanjis` (single-char path) → `word_examples` → `not_found`.
  - Prompt rule: always lookup first; never invent meanings; on
    `not_found`, say so.
  - Tracked as TaskCreate #64 (L1: `/api/lookup/batch` route + DB
    cascade) and #65 (L2: `lookup_word` / `lookup_words_batch` tools).

### Speed

- E2B is fundamentally ~30–80 tok/s on iPhone 15 Pro-class hardware.
- Mitigations landed: prefix-stable tool serialization (alphabetical
  sort), 32K KV cache preserves history → fewer recomputes, scope-
  filtered catalog cuts ~700 tokens off non-general turns.
- Open: explicit "first token at T+X" UX feedback during the wait.

### Empty conversation-history bug (reported by user, 2026-05-17)

- Symptom: user actively chats but `/assistant/sessions` shows
  "저장된 대화가 없습니다.".
- Unresolved. Working hypothesis: `createSession` fails silently
  (LOGIN_REQUIRED or transient) → in-memory fallback session → its rows
  never reach `ai_sessions` so `listSessions` returns nothing.
- Not currently in the task queue. Pick up after the cascade lookup
  work or in parallel.

### Simulator verification (this session, interrupted)

- iPhone 17 Pro simulator build + install succeeded.
- Landing page renders, all 5 features (including the new AI line)
  visible.
- Login automation blocked on macOS Accessibility permission for the
  Terminal that's running this shell. User granted permission late in
  the session but the workflow stopped before resuming. Resume by
  re-running `cliclick` from this shell and tapping the simulator
  programmatically.

## Open task queue (as of 2026-05-18)

- **#64** L1 — `/api/lookup/batch` route + DB cascade
- **#65** L2 — `lookup_word` + `lookup_words_batch` tools
- **(unfiled)** Conversation-history empty bug
- **(unfiled)** Resume simulator verification (login → assistant →
  send messages → check tool chips, rating tone, ID shortening live)
- **(unfiled)** Apple Developer portal `increased-memory-limit`
  entitlement request — production builds need this for the largest
  KV cache bucket

## Aggregate stats

- iOS native code: ~1200 lines of Swift.
- Chat module code: ~3000 lines of TypeScript.
- Unit tests: 75 chat-module tests, all passing.
- Commits directly related to on-device LLM: 30+.
- Active / complete docs: 11 files across `_docs/active/` and
  `_docs/complete/`.
