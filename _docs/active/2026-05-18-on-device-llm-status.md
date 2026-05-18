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
| Jetsam OOM mid-stream | 32K cache + GPU weights ≈ 2.5 GB working set, exceeds default Jetsam | `increased-memory-limit` (production, self-service via Apple Developer portal — see §3.1) + `increased-debugging-memory-limit` (debug, no portal action needed) |
| Xcode 26.5 link error | `__preview.dylib` implicit-links SwiftUICore, rejected | Local config plugin `with-disable-previews` (sets `ENABLE_PREVIEWS = NO`) |

### 3.1 Enabling `increased-memory-limit` for production (Apple DTS, 2026-05-18)

Contacted Apple Developer Support to clarify the activation process for
`com.apple.developer.kernel.increased-memory-limit`.
Case **102890625077**. Reply from DTS engineer **Soo** pointed to the
canonical thread <https://developer.apple.com/forums/thread/685084>
(DTS Engineer Quinn "The Eskimo!" answers).

**Key clarifications:**

- This is **not an approval-gated entitlement** — it is a self-service
  capability. The previous "Apple approval pending" framing in this doc
  was wrong.
- Adding the entitlement directly to `.entitlements` is **not
  sufficient** — every entitlement must be authorized by a
  provisioning profile, so the App ID must opt in to the capability
  first.
- The Xcode "Signing & Capabilities" editor currently does **not**
  surface the "Increased Memory Limit" row (Apple has filed a bug
  internally), so the workflow has to go through the developer portal.

**Workflow (per Quinn's reply):**

1. developer.apple.com → **Certificates, Identifiers & Profiles** →
   Identifiers → select the app's App ID.
2. Enable the **"Increased Memory Limit"** capability and save.
3. Regenerate / redownload the provisioning profile (or let Xcode
   automatic signing refetch it).
4. For Xcode automatic-signing flows, follow the same pattern documented
   for Multicast Networking:
   <https://developer.apple.com/forums/thread/663271> — substitute
   "Increased Memory Limit" for "Multicast Networking" throughout.
5. Keep the entitlement key in `Nivoca.entitlements`; the profile +
   capability are what make it actually grant the elevated limit at
   runtime.

**Caveat to verify after enabling.**
A developer in thread/685084 reported that on **iOS 15.3** the
entitlement signed in correctly but `os_proc_available_memory()` still
returned the unentitled limit — i.e. the capability was authorized but
the kernel did not raise the cap. On modern iOS this is likely fixed,
but we need to confirm empirically: after enabling, run a release
build on a physical device and log `os_proc_available_memory()` at
launch. If the value is the same as the no-entitlement baseline,
escalate back to DTS on the same case (102890625077) before assuming
the larger KV-cache bucket is safe in production.

**Note on the related `extended-virtual-addressing` entitlement.**
Apple's reply did not address this one. Per memory + Phase B above it
still appears to be paid-account-only for Personal Team signing, which
is what blocks Phase D-A. The forum thread does confirm
`extended-virtual-addressing` is a real, separate entitlement (less
documented) — so the long-term answer to the Personal Team mmap-cap
crash remains: upgrade to a paid Apple Developer Program membership.
That decision is independent of the `increased-memory-limit` work above.

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

### Empty conversation-history bug (reported by user, 2026-05-17 → fix landed 2026-05-18)

- Symptom: user actively chats but `/assistant/sessions` shows
  "저장된 대화가 없습니다.".
- **Confirmed root cause.** Three failure surfaces stacked on top of
  each other:
  1. `SupabaseChatRepository.currentUserId()` (`supabase-repo.ts:1859`)
     threw `LOGIN_REQUIRED` whenever `auth.getUser()` returned null. In
     the mobile WebView this happens during the brief window where
     `AuthProvider` has called `setSession({ access_token: '' })` and
     Supabase is still refreshing the JWT via the stored refresh
     token — `authLoading` flips to false based on the auth-store
     `user` object, but the Supabase client's own session may not be
     populated yet.
  2. `useChatStore.ensureSession(scope='general')`
     (`chat/store.ts:245`) caught the `LOGIN_REQUIRED` throw with a
     `devWarn` (silent in production) and substituted an in-memory
     `newSession(scope)` with a fresh client-generated UUID.
  3. Every subsequent `appendMessage` then sent that fake UUID as
     `session_id`, which Supabase rejected on the
     `ai_messages.session_id → ai_sessions(id)` foreign key — but
     that throw was *also* caught by `devWarn` (chat is "optimistic
     — the bubble already renders"). End result: bubbles in the UI,
     zero rows in `ai_sessions` / `ai_messages`, `/assistant/sessions`
     empty.
- **Fix landed (3 commits planned):**
  1. `currentUserId()` now retries once via
     `supabase.auth.refreshSession()` before throwing — handles the
     WebView token-refresh race directly at the lowest layer.
  2. `ensureSession` no longer falls back to in-memory for the
     `general` scope. On failure it lets the error propagate to
     `sendMessage`, which logs a structured `[chat] ensureSession(general) failed`
     line (visible in production console — code/message/details
     scrubbed of message content) and shows a localized toast:
     *"AI 채팅 세션을 시작하지 못했습니다. 다시 로그인 후 시도해주세요."* /
     *"Could not start the AI chat session. Please re-login and try again."*
  3. `logChatFailure()` helper added alongside the existing
     `devWarn` — same structured shape, but always emits regardless
     of `NODE_ENV`, reserved for terminal failures only (not the
     per-message `appendMessage` blips that legitimately want to
     stay quiet).
- Word / wordbook / quiz scopes are unchanged — their in-memory
  fallback is "ephemeral by design" per `shouldPersistScope`.
- Tests: all 75 chat-module tests still pass after the change
  (`bunx vitest run src/lib/ai/chat`).

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
- **(unfiled)** Apple Developer portal — enable `increased-memory-limit`
  capability on the App ID (self-service per DTS case 102890625077; see
  §3.1). Steps: portal → Identifiers → enable "Increased Memory Limit"
  → regenerate provisioning profile → release build on device → verify
  `os_proc_available_memory()` actually reports the elevated limit
  (the 685084 thread flags a case where it did not). Needed before the
  largest KV-cache bucket is safe in production.
- **(unfiled, separate track)** `extended-virtual-addressing` for
  Personal Team / Phase D-A — still blocked on upgrading to a paid
  Apple Developer Program membership; not resolvable from the portal
  on a Personal Team.

## Aggregate stats

- iOS native code: ~1200 lines of Swift.
- Chat module code: ~3000 lines of TypeScript.
- Unit tests: 75 chat-module tests, all passing.
- Commits directly related to on-device LLM: 30+.
- Active / complete docs: 11 files across `_docs/active/` and
  `_docs/complete/`.
