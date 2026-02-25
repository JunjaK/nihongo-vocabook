# Codebase Map

Quick-reference file paths for the most frequently accessed areas.
**Always check here first** before exploring the codebase.

## Core Infrastructure

| Purpose | Path |
|---------|------|
| App layout | `src/app/layout.tsx` |
| Global CSS | `src/app/globals.css` |
| Style constants | `src/lib/styles.ts` |
| Auth store | `src/stores/auth-store.ts` |
| Repository interface | `src/lib/repository/types.ts` |
| Repository provider | `src/lib/repository/provider.tsx` |
| Supabase repository | `src/lib/repository/supabase-repo.ts` |
| IndexedDB repository | `src/lib/repository/indexeddb-repo.ts` |
| Dexie schema | `src/lib/db/dexie.ts` |
| Supabase client | `src/lib/supabase/client.ts` |
| i18n types | `src/lib/i18n/types.ts` |
| i18n translations (en) | `src/lib/i18n/en.ts` |
| i18n translations (ko) | `src/lib/i18n/ko.ts` |
| i18n provider | `src/lib/i18n/index.tsx` |
| Spaced repetition (FSRS) | `src/lib/spaced-repetition.ts` |
| OCR extraction | `src/lib/ocr/extract.ts` |
| OCR Tesseract | `src/lib/ocr/tesseract.ts` |
| Image processing | `src/lib/image/` |
| AES crypto | `src/lib/crypto/` |
| Scan store (Zustand) | `src/stores/scan-store.ts` |
| Navigation lock store | `src/stores/navigation-lock-store.ts` |
| PWA manifest | `src/app/manifest.ts` |

## Layout Components

| Component | Path |
|-----------|------|
| MobileShell | `src/components/layout/mobile-shell.tsx` |
| Header | `src/components/layout/header.tsx` |
| BottomNav | `src/components/layout/bottom-nav.tsx` |
| ListToolbar | `src/components/layout/list-toolbar.tsx` |
| AuthProvider | `src/components/layout/consent-gate.tsx` |
| SW Update Notifier | `src/components/layout/sw-update-notifier.tsx` |

## Pages Overview

| Feature | Page Entry | Key Components |
|---------|-----------|----------------|
| Words list | `src/app/(app)/words/page.tsx` | SwipeableWordCard, WordSearch |
| Word create | `src/app/(app)/words/create/page.tsx` | WordForm |
| Word detail | `src/app/(app)/words/[id]/page.tsx` | — |
| Word scan | `src/app/(app)/words/scan/page.tsx` | ImageCapture, WordPreview |
| Wordbooks list | `src/app/(app)/wordbooks/page.tsx` | WordbookCard |
| Wordbook detail | `src/app/(app)/wordbooks/[id]/page.tsx` | — |
| Wordbook add words | `src/app/(app)/wordbooks/[id]/add-words/page.tsx` | WordSearch |
| Wordbook practice | `src/app/(app)/wordbooks/[id]/practice/page.tsx` | PracticeFlashcard |
| Browse wordbooks | `src/app/(app)/wordbooks/browse/page.tsx` | WordbookCard |
| Quiz | `src/app/(app)/quiz/page.tsx` | Flashcard, SessionReport |
| Mastered words | `src/app/(app)/mastered/page.tsx` | WordCard |
| Settings | `src/app/(app)/settings/page.tsx` | — |
| Quiz settings | `src/app/(app)/settings/quiz/page.tsx` | — |
| Quiz stats | `src/app/(app)/settings/quiz-stats/page.tsx` | — |
| Achievements | `src/app/(app)/settings/achievements/page.tsx` | — |

## Domain Components

| Component | Path |
|-----------|------|
| WordCard | `src/components/word/word-card.tsx` |
| SwipeableWordCard | `src/components/word/swipeable-word-card.tsx` |
| WordForm | `src/components/word/word-form.tsx` |
| WordSearch | `src/components/word/word-search.tsx` |
| WordbookCard | `src/components/wordbook/wordbook-card.tsx` |
| WordbookForm | `src/components/wordbook/wordbook-form.tsx` |
| ImportWordbookDialog | `src/components/wordbook/import-wordbook-dialog.tsx` |
| Flashcard (SRS) | `src/components/quiz/flashcard.tsx` |
| PracticeFlashcard | `src/components/quiz/practice-flashcard.tsx` |
| SessionReport | `src/components/quiz/session-report.tsx` |
| ImageCapture | `src/components/scan/image-capture.tsx` |
| WordPreview | `src/components/scan/word-preview.tsx` |
| WordConfirm | `src/components/scan/word-confirm.tsx` |
| ScanComplete | `src/components/scan/scan-complete.tsx` |

## API Routes

| Route | Path |
|-------|------|
| Dictionary lookup | `src/app/api/dictionary/route.ts` |
| OCR Vision | `src/app/api/ocr/vision/route.ts` |

## Types

| Type | Path |
|------|------|
| Word, StudyProgress | `src/types/word.ts` |
| Wordbook | `src/types/wordbook.ts` |
| Quiz types | `src/types/quiz.ts` |

## Scan/OCR System

| Purpose | Path |
|---------|------|
| Scan store (background extraction) | `src/stores/scan-store.ts` |
| OCR extraction pipeline | `src/lib/ocr/extract.ts` |
| Tesseract worker | `src/lib/ocr/tesseract.ts` |
| LLM Vision OCR | `src/lib/ocr/llm-vision.ts` |
| Image processing | `src/lib/image/` |

## Quiz/SRS System

| Purpose | Path |
|---------|------|
| Quiz session store | `src/lib/quiz/session-store.ts` |
| Achievement definitions | `src/lib/quiz/achievement-defs.ts` |
| Achievement logic | `src/lib/quiz/achievements.ts` |

## Database

| Purpose | Path |
|---------|------|
| Supabase migrations | `supabase/migrations/` |
| Dexie (IndexedDB) schema | `src/lib/db/dexie.ts` |

## Tests

| Type | Path |
|------|------|
| E2E tests | `e2e/` |
| E2E fixtures | `e2e/fixtures/` |
