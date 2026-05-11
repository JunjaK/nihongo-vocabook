# Replace Cloud OCR LLM with On-device Gemma 4

> Status: Planning

## Goal

Replace the current cloud-based LLM vision OCR (gpt-5-nano / Claude Sonnet 4.6 /
Gemini 3 Flash via user-supplied API key) with on-device Gemma 4 inference.

Eliminate the BYO API key barrier for vocabulary scan, while keeping the same
structured output (`{term, reading, meaning, jlptLevel}`) and downstream pipeline
(`term-filter`, normalization, dedup).

## Motivation

- API key entry is the single largest UX barrier for non-power users.
- gpt-5-nano per-scan cost is already negligible; the cost dimension is NOT the
  primary driver — it's friction removal.
- Single-user project (no migration notification needed).

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Model size | **E2B everywhere** (web + iOS). Re-evaluate E4B on iOS later. |
| 2 | Cloud provider code | **Delete entirely**. OpenAI / Anthropic / Gemini code paths removed. |
| 3 | Tesseract | **Keep as fallback** (model not installed, or user dismissed). |
| 4 | Entry UX | **Soft modal** at scan entry. Dismissible (X) and remembered per-device. |
| 5 | iOS execution | **Native module via bridge** (react-native-litert-lm), not in WebView. |
| 6 | DB migration | **Drop columns silently**. No user notice required. |

### Modal UX flow (decision 4)

```
[Scan entry]
  └ model installed? ─── yes ──→ Gemma 4
       │
       no
       │
       ├─ dismissed=false ──→ [Modal: "Download AI model for higher accuracy"]
       │     ├─ Download → progress → install → Gemma 4
       │     └─ Dismiss (X) → store dismissed=true → Tesseract fallback
       │
       └─ dismissed=true ────────→ Tesseract fallback (silent)

[Settings > AI Model]
  - State: not installed / downloading X% / installed (1.5GB)
  - Buttons: Download / Update / Delete
  - Triggering Download here clears the dismissed flag.
```

## Architecture

### Shared interface

```
apps/web/src/lib/ai/
  ├── types.ts            # AiVisionAdapter interface, shared types
  ├── model-manager.ts    # Download state, progress, storage check
  └── gemma-web.ts        # transformers.js Gemma 4 E2B adapter
```

```ts
// apps/web/src/lib/ai/types.ts
export interface AiVisionAdapter {
  isReady(): Promise<boolean>;
  extractWords(imageDataUrl: string, locale: string, signal?: AbortSignal):
    Promise<ExtractedWord[]>;
}
```

### Web path

- Library: `@huggingface/transformers` (transformers.js v3) with ONNX runtime
- Model: `onnx-community/gemma-4-E2B-it-ONNX`, dtype `q4f16`, device `webgpu`
- Storage: IndexedDB / Cache API (managed by transformers.js)
- Quota: request `navigator.storage.persist()` after first successful load
- Progress: `progress_callback` plumbed to UI

### iOS native path

- Library: `react-native-litert-lm`
- Model file: downloaded to `FileSystem.documentDirectory + 'models/gemma-4-E2B.task'`
- Download manager: `expo-file-system` `createDownloadResumable` (pause/resume)
- Network gate: `expo-network` Wi-Fi check, warn before cellular
- Bridge messages (extend `WebToNativeMessage` / `NativeToWebMessage`):
  ```
  Web→Native: AI_MODEL_STATUS, AI_MODEL_DOWNLOAD_START, AI_MODEL_DOWNLOAD_CANCEL,
              AI_MODEL_DELETE, AI_INFER_VISION
  Native→Web: AI_MODEL_STATUS_RESULT, AI_MODEL_DOWNLOAD_PROGRESS,
              AI_MODEL_DOWNLOAD_COMPLETE, AI_INFER_VISION_RESULT
  ```

### Routing in extract.ts

```ts
// Pseudo
const adapter = await pickAdapter(); // gemma if ready, else null
if (adapter) return adapter.extractWords(...);
return tesseractFallback(...);
```

The current `OcrMode = 'ocr' | 'llm' | 'hybrid'` is reduced to an internal
implementation detail. User no longer picks a mode.

## Migration

Single-user project — no notification, drop in place.

- **Supabase migration**: `supabase/migrations/<timestamp>_drop_ocr_llm_settings.sql`
  ```sql
  alter table user_settings
    drop column if exists llm_provider,
    drop column if exists encrypted_api_key;
  ```
- **Delete** `apps/web/src/app/api/ocr/vision/route.ts`
- **Delete** `apps/web/src/app/api/settings/ocr/route.ts` (if exists)
- **Delete** API-key form UI in settings page
- **Simplify** `apps/web/src/lib/ocr/settings.ts` — remove `LlmProvider`,
  remove `OcrServerSettings`, keep only local mode helpers (or remove fully)
- **Remove** `decrypt`/`encrypt` AES path for OCR keys if not used elsewhere
  (verify other consumers first)

## Risks

| Risk | Mitigation |
|------|-----------|
| E2B vision quality < gpt-5-nano on Japanese (furigana / rare kanji / stylized fonts) | Benchmark phase before shipping; abort if quality drop is severe |
| First-load 1.5GB download UX cliff | Soft modal, progress, resumable, Wi-Fi guidance, settings-level control |
| Browser storage quota on iOS Safari PWA (~1GB) | Request `storage.persist()`, fallback to Tesseract gracefully if quota fails |
| Mobile RAM pressure (8GB phone, model + KV + WebView) | Use native module (decision 5) instead of WebGPU in WebView |
| Hallucinated readings polluting wordbook | Keep term-filter pipeline; consider passing Tesseract candidates into prompt as anchor |
| transformers.js multimodal API maturity for Gemma 4 vision input | Spike during benchmark phase; if not ready, hold web rollout, ship iOS first |

## Benchmark (Phase 1, gate decision)

Before any production code:

- Collect 20–30 real scan images representative of usage
  (textbook / menu / manga / handwriting / vertical / mixed)
- Run gpt-5-nano (current production) vs Gemma 4 E2B on each
- Compare on:
  - Term recall (vs ground truth)
  - Reading accuracy (hiragana correctness)
  - Meaning accuracy (KO/EN translation correctness)
  - JLPT level assignment
  - Hallucination rate (terms not present in image)
  - End-to-end latency (after warmup)
- **Go / no-go gate**: if Gemma 4 E2B recall drops > 25% OR hallucination rate
  doubles, revisit plan (consider E4B-only iOS first, web stays on cloud)

Output: `_docs/ocr/gemma4-benchmark-2026-05.md` with raw numbers.

## Checklist

### Phase 1 — Benchmark (gate)
- [ ] Collect 20–30 scan image samples
- [ ] Build minimal benchmark harness (Node script or one-off page)
- [ ] Run gpt-5-nano baseline, record outputs
- [ ] Run Gemma 4 E2B via transformers.js, record outputs
- [ ] Score and document results
- [ ] Go/no-go decision recorded in this doc

### Phase 2 — Shared AI layer
- [ ] `apps/web/src/lib/ai/types.ts` — adapter interface
- [ ] `apps/web/src/lib/ai/model-manager.ts` — download state, dismissed flag,
      storage checks
- [ ] i18n keys for download modal + settings panel (ko, en)

### Phase 3 — Web (E2B via transformers.js)
- [ ] Add `@huggingface/transformers` dep
- [ ] `apps/web/src/lib/ai/gemma-web.ts` adapter
- [ ] Hook into `extract.ts` (replace `mode === 'llm'` branch)
- [ ] Download modal component (`components/scan/model-download-modal.tsx`)
- [ ] Settings page section: model state + download/update/delete buttons
- [ ] Remove API-key form, related routes, related settings code

### Phase 4 — DB cleanup
- [ ] Migration: drop `llm_provider`, `encrypted_api_key` columns
- [ ] Remove `/api/ocr/vision`, `/api/settings/ocr`
- [ ] Verify no remaining references to `LlmProvider` / `decrypt`(OCR path)

### Phase 5 — iOS native (E2B via litert-lm)
- [ ] Add `react-native-litert-lm` to `apps/mobile`
- [ ] Native download manager (resumable, Wi-Fi gate, free-space check)
- [ ] Extend bridge types (web side + mobile side)
- [ ] Native inference handler for `AI_INFER_VISION`
- [ ] Test on iPhone 15 Pro+ device
- [ ] Verify memory under sustained scanning

### Phase 6 — Polish
- [ ] Storage `persist()` request after first install
- [ ] Telemetry: scan source (gemma | tesseract), latency, term count
- [ ] Re-run benchmark on shipped build for regression check

## Implementation Notes

(Filled during execution.)

## User Feedback

(Filled during review.)

## Final Summary

(Post-completion rewrite.)
