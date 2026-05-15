# Plan: OCR/LLM-Based Word Addition from Images

## Context

Currently, adding words requires manual typing or searching Jisho one-by-one. Users want to photograph Japanese text (textbooks, signs, menus) and bulk-add extracted words. Two extraction modes:

- **OCR (Tesseract.js)**: Free, client-side, ~14MB language data from CDN. Good for printed text.
- **LLM Vision**: User provides their own API key (OpenAI / Anthropic / Gemini). Better accuracy, especially for handwriting or complex layouts. Runs via server-side API route to protect keys from CORS/exposure.

Two different flows depending on extraction mode:

- **OCR flow**: Capture image → Extract raw text → Preview word list (checkboxes) → Sequential Jisho confirm per word → Completion
- **LLM flow**: Capture image → LLM returns structured words (term/reading/meaning) → Preview checklist with details → User confirms → Words added directly → Completion

---

## 1. Settings — OCR/LLM Configuration

**File: `src/app/(app)/settings/page.tsx`** — MODIFY

Add "OCR / AI" section after Theme, before Data Migration:
- Mode selector: `OCR (무료)` | `LLM Vision`
- Link to detail page: "설정 >" → navigates to `/settings/ocr`
- Shows current mode as summary text

**New file: `src/app/(app)/settings/ocr/page.tsx`** — OCR settings detail page

Full configuration UI:
- Mode selector: `OCR (무료)` | `LLM Vision`
- When LLM selected: provider dropdown (`OpenAI` / `Anthropic` / `Gemini`), API key input (password type), test connection button (optional stretch)
- API key stored in localStorage via helper functions (SSR-safe)
- Header with back button

**New file: `src/lib/ocr/settings.ts`**

```ts
type OcrMode = 'ocr' | 'llm';
type LlmProvider = 'openai' | 'anthropic' | 'gemini';

interface OcrSettings {
  mode: OcrMode;
  llmProvider: LlmProvider;
  apiKey: string;
}

// localStorage getters/setters with SSR guard
function getOcrSettings(): OcrSettings { ... }
function setOcrSettings(settings: Partial<OcrSettings>): void { ... }
function isLlmConfigured(settings: OcrSettings): boolean {
  return settings.mode === 'llm' && !!settings.apiKey;
}
```

**API key guard**: When scan wizard starts with LLM mode but no API key configured, show inline message with link to `/settings/ocr` to configure. Block extraction until configured.

---

## 2. Image Capture Step

**New file: `src/app/(app)/words/scan/page.tsx`** — Main wizard page

Uses `createLocalStore` (`src/stores/create-local-store.ts`) for wizard state:

```ts
interface ScanState {
  step: 'capture' | 'preview' | 'confirm' | 'done';
  mode: 'ocr' | 'llm';
  imageDataUrl: string | null;
  // OCR: raw strings; LLM: structured objects
  extractedRawWords: string[];              // OCR mode
  extractedStructuredWords: ExtractedWord[]; // LLM mode
  selectedIndices: number[];                // checked item indices
  addedCount: number;
  currentConfirmIndex: number;              // OCR confirm step only
  // actions...
}
```

**New file: `src/components/scan/image-capture.tsx`**

- Camera button (uses `<input type="file" accept="image/*" capture="environment">` for mobile camera)
- Gallery button (uses `<input type="file" accept="image/*">` without capture)
- Image preview with thumbnail after selection
- "Extract" button → triggers OCR or LLM extraction
- Loading state during extraction

---

## 3. Text Extraction

**New file: `src/lib/ocr/extract.ts`** — Orchestrator

```ts
async function extractWordsFromImage(
  imageDataUrl: string,
  settings: OcrSettings,
): Promise<string[]>
```

Delegates to OCR or LLM based on settings. Returns array of extracted Japanese word strings.

### 3a. OCR — Tesseract.js

**New file: `src/lib/ocr/tesseract.ts`**

```ts
async function extractWithTesseract(imageDataUrl: string): Promise<string>
```

- Uses `tesseract.js` (npm package) with `jpn` language
- Worker runs in browser, language data loaded from CDN
- Returns raw text → parent splits into individual words using Japanese word boundary regex

**Package to install:** `tesseract.js` (v5+)

### 3b. LLM Vision — API Route

**New file: `src/app/api/ocr/vision/route.ts`**

POST endpoint. Request body: `{ provider, apiKey, imageBase64 }`. Server-side calls to provider APIs.

**Dev testing fallback**: If `NEXT_PRIVATE_OPENAI_API_KEY` env var is set and no `apiKey` is provided in request, use env key with OpenAI. This is for development only — env key will be removed before production.

Provider-specific calls:

- **OpenAI**: `POST https://api.openai.com/v1/chat/completions` with `gpt-5-nano`, image as base64 data URL in content
- **Anthropic**: `POST https://api.anthropic.com/v1/messages` with `claude-sonnet-4-20250514`, image as base64 in content block
- **Gemini**: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent` with inline image data

All three receive the same system prompt:
> "Extract all Japanese words/phrases from this image. For each word, provide the dictionary form (term), reading in hiragana, and meaning in Korean. Return ONLY a JSON array of objects: [{\"term\": \"食べる\", \"reading\": \"たべる\", \"meaning\": \"먹다\"}]. No explanation."

Response: `{ words: { term: string; reading: string; meaning: string }[] }`

**New file: `src/lib/ocr/llm-vision.ts`** — Client-side caller

```ts
interface ExtractedWord {
  term: string;
  reading: string;
  meaning: string;
}

async function extractWithLlm(
  imageDataUrl: string,
  provider: LlmProvider,
  apiKey: string,
): Promise<ExtractedWord[]>
```

Calls `/api/ocr/vision` with fetch, returns parsed structured word array.

---

## 4. Preview Step (Checklist)

**New file: `src/components/scan/word-preview.tsx`**

Two display modes based on extraction source:

**OCR mode** — raw word strings:
- List of extracted words with checkboxes (all checked by default)
- Select all / deselect all toggle
- "Confirm selected" button → proceeds to sequential Jisho confirm step

**LLM mode** — structured word objects (term, reading, meaning):
- List with checkboxes showing term, reading, and meaning per row
- Select all / deselect all toggle
- "Add selected" button → adds all checked words directly via `repo.words.create()` → proceeds to completion step (skips Jisho confirm)

Common:
- Empty state if no words extracted (with retry option)

---

## 5. Sequential Confirm Step

**New file: `src/components/scan/word-confirm.tsx`**

For each selected word, one at a time:
- Progress indicator: `1 / N`
- Auto-search Jisho via `searchDictionary()` from `src/lib/dictionary/jisho.ts`
- Show dictionary results as selectable cards (reuse pattern from `WordSearch` component at `src/components/word/word-search.tsx`)
- On select: pre-fill term, reading, meaning, JLPT from dictionary entry
- Editable fields: meaning (Korean), notes — shown inline (not full WordForm)
- "Add" button saves via `repo.words.create()` and advances to next word
- "Skip" button to skip current word
- If no Jisho results: show manual entry fields (term pre-filled, user enters reading + meaning)

---

## 6. Completion Step

**New file: `src/components/scan/scan-complete.tsx`**

- Success icon (`CheckCircle` from `@/components/ui/icons`, Tabler-backed)
- Summary: "N words added"
- "Add more" button → reset wizard to capture step
- "Go to word list" button → navigate to `/words`
- Optional: "Add to wordbook" button → opens `AddToWordbookDialog` for bulk add (stretch goal — skip for v1)

---

## 7. Navigation Entry Point

**File: `src/app/(app)/words/new/page.tsx`** — MODIFY (becomes choice page)

Same pattern as `/wordbooks/new` — two option cards:
- **사전 검색** → `/words/create` (current word form)
- **이미지로 추가** → `/words/scan` (new wizard)

**New file: `src/app/(app)/words/create/page.tsx`** — CREATE

Move current `/words/new/page.tsx` logic here (Header + WordForm). Thin wrapper, same as current `new/page.tsx`.

**File: `src/app/(app)/words/[id]/page.tsx`** — MODIFY (edit link)

Update edit navigation from `/words/new` to `/words/create` if applicable (check existing edit flow).

---

## 8. i18n Keys

**Files: `src/lib/i18n/types.ts`, `ko.ts`, `en.ts`** — MODIFY

New `scan` section (~20 keys):

| Key | Korean | English |
|-----|--------|---------|
| `title` | `'이미지로 단어 추가'` | `'Add words from image'` |
| `captureTitle` | `'이미지 선택'` | `'Select image'` |
| `takePhoto` | `'사진 촬영'` | `'Take photo'` |
| `chooseFromGallery` | `'갤러리에서 선택'` | `'Choose from gallery'` |
| `extracting` | `'텍스트 추출 중...'` | `'Extracting text...'` |
| `noWordsFound` | `'단어를 찾지 못했습니다'` | `'No words found'` |
| `retry` | `'다시 시도'` | `'Retry'` |
| `previewTitle` | `'추출된 단어'` | `'Extracted words'` |
| `selectAll` | `'전체 선택'` | `'Select all'` |
| `deselectAll` | `'전체 해제'` | `'Deselect all'` |
| `confirmSelected` | `'선택한 단어 확인'` | `'Confirm selected'` |
| `addWord` | `'추가'` | `'Add'` |
| `skip` | `'건너뛰기'` | `'Skip'` |
| `searchingDictionary` | `'사전 검색 중...'` | `'Searching dictionary...'` |
| `noResults` | `'사전 결과 없음'` | `'No dictionary results'` |
| `manualEntry` | `'직접 입력'` | `'Manual entry'` |
| `complete` | `'완료!'` | `'Complete!'` |
| `wordsAdded` | `(n) => \`${n}개 단어 추가됨\`` | `(n) => \`${n} words added\`` |
| `addMore` | `'더 추가하기'` | `'Add more'` |
| `goToWords` | `'단어 목록으로'` | `'Go to word list'` |
| `extract` | `'추출'` | `'Extract'` |

New keys in `settings` section:

| Key | Korean | English |
|-----|--------|---------|
| `ocrTitle` | `'OCR / AI'` | `'OCR / AI'` |
| `ocrMode` | `'텍스트 추출 방식'` | `'Text extraction mode'` |
| `ocrFree` | `'OCR (무료)'` | `'OCR (free)'` |
| `llmVision` | `'LLM Vision'` | `'LLM Vision'` |
| `llmProvider` | `'AI 제공자'` | `'AI provider'` |
| `apiKey` | `'API 키'` | `'API key'` |
| `apiKeyPlaceholder` | `'sk-...'` | `'sk-...'` |
| `apiKeySaved` | `'API 키 저장됨'` | `'API key saved'` |
| `ocrSettings` | `'OCR / AI 설정'` | `'OCR / AI Settings'` |
| `configureRequired` | `'LLM Vision을 사용하려면 API 키를 설정하세요'` | `'Configure API key to use LLM Vision'` |
| `goToSettings` | `'설정하기'` | `'Go to settings'` |

---

## 9. File Summary

| File | Action |
|------|--------|
| `src/app/(app)/words/scan/page.tsx` | **CREATE** — wizard page with local store |
| `src/components/scan/image-capture.tsx` | **CREATE** — capture/upload step |
| `src/components/scan/word-preview.tsx` | **CREATE** — checklist step |
| `src/components/scan/word-confirm.tsx` | **CREATE** — sequential Jisho confirm step |
| `src/components/scan/scan-complete.tsx` | **CREATE** — completion summary |
| `src/lib/ocr/settings.ts` | **CREATE** — localStorage settings helpers |
| `src/lib/ocr/extract.ts` | **CREATE** — extraction orchestrator |
| `src/lib/ocr/tesseract.ts` | **CREATE** — Tesseract.js wrapper |
| `src/lib/ocr/llm-vision.ts` | **CREATE** — LLM Vision client caller |
| `src/app/api/ocr/vision/route.ts` | **CREATE** — server-side LLM proxy |
| `src/app/(app)/words/new/page.tsx` | **MODIFY** — becomes choice page (dictionary vs image) |
| `src/app/(app)/words/create/page.tsx` | **CREATE** — moved word form (from old new/page.tsx) |
| `src/app/(app)/settings/page.tsx` | **MODIFY** — add OCR/AI summary + link to detail |
| `src/app/(app)/settings/ocr/page.tsx` | **CREATE** — OCR/LLM settings detail page |
| `src/lib/i18n/types.ts` | **MODIFY** — add `scan` section + settings keys |
| `src/lib/i18n/ko.ts` | **MODIFY** — add Korean translations |
| `src/lib/i18n/en.ts` | **MODIFY** — add English translations |

**Package:** `bun add tesseract.js`

---

## 10. Key Reuse

| What | Where |
|------|-------|
| `searchDictionary()` | `src/lib/dictionary/jisho.ts` — used in confirm step for auto-search |
| `createLocalStore()` | `src/stores/create-local-store.ts` — wizard state management |
| `repo.words.create()` | Repository pattern — saving confirmed words |
| Bottom fixed button pattern | `shrink-0 bg-background px-4 pb-3` with separator — all wizard steps |
| `AddToWordbookDialog` | `src/components/wordbook/add-to-wordbook-dialog.tsx` — potential future use |
| Animation classes | `animate-fade-in`, `animate-stagger`, `animate-page` — applied to wizard steps |
| `Header` with `showBack` | `src/components/layout/header.tsx` — wizard header |

---

## 11. Implementation Order

1. `bun add tesseract.js`
2. `src/lib/ocr/settings.ts` — settings helpers
3. `src/app/api/ocr/vision/route.ts` — LLM proxy API route
4. `src/lib/ocr/tesseract.ts` → `src/lib/ocr/llm-vision.ts` → `src/lib/ocr/extract.ts` — extraction layer
5. `src/lib/i18n/types.ts` → `ko.ts` → `en.ts` — i18n keys
6. `src/app/(app)/settings/ocr/page.tsx` — OCR settings detail page
7. `src/app/(app)/settings/page.tsx` — add OCR summary section with link
8. `src/components/scan/*` — all 4 wizard step components
9. `src/app/(app)/words/scan/page.tsx` — wizard page with store
10. `src/app/(app)/words/create/page.tsx` — move current form here
11. `src/app/(app)/words/new/page.tsx` — convert to choice page
12. `bun run build` — verify no type errors

---

## 12. Verification

1. `bun run build` — no type errors
2. Settings page: toggle OCR/LLM mode, enter API key, verify localStorage persistence
3. OCR flow: select image with Japanese text → extract → preview checklist → confirm each → completion
4. LLM flow: same with API key set → verify server-side API call works
5. Confirm step: Jisho auto-search returns results → select → meaning field editable → add saves word
6. Confirm step: word with no Jisho results → manual entry fields shown → add saves word
7. Skip: skipping a word advances to next without saving
8. Completion: correct count shown, "add more" resets wizard, "go to words" navigates correctly
9. Words page: "+ 추가" → choice page with "사전 검색" and "이미지로 추가" options
10. Choice page: "사전 검색" → word form, "이미지로 추가" → scan wizard
