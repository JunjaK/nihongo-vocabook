# Codebase Map

Quick-reference file paths for the most frequently accessed areas.
**Always check here first** before exploring the codebase.

## Monorepo Structure

```
nihongo-vocabook/
├── apps/web/          # Next.js web app
├── apps/mobile/       # Expo React Native app (WebView + native features)
├── packages/          # Shared packages (future)
├── supabase/          # Shared infra (migrations, seeds)
└── _docs/             # Shared documentation
```

## Web App — Core Infrastructure

| Purpose | Path |
|---------|------|
| App layout | `apps/web/src/app/layout.tsx` |
| Global CSS | `apps/web/src/app/globals.css` |
| Style constants | `apps/web/src/lib/styles.ts` |
| Auth store | `apps/web/src/stores/auth-store.ts` |
| Repository interface | `apps/web/src/lib/repository/types.ts` |
| Repository provider | `apps/web/src/lib/repository/provider.tsx` |
| Supabase repository | `apps/web/src/lib/repository/supabase-repo.ts` |
| IndexedDB repository | `apps/web/src/lib/repository/indexeddb-repo.ts` |
| Dexie schema | `apps/web/src/lib/db/dexie.ts` |
| Supabase client | `apps/web/src/lib/supabase/client.ts` |
| i18n types | `apps/web/src/lib/i18n/types.ts` |
| i18n translations (en) | `apps/web/src/lib/i18n/en.ts` |
| i18n translations (ko) | `apps/web/src/lib/i18n/ko.ts` |
| i18n provider | `apps/web/src/lib/i18n/index.tsx` |
| Spaced repetition (FSRS) | `apps/web/src/lib/spaced-repetition.ts` |
| OCR extraction | `apps/web/src/lib/ocr/extract.ts` |
| OCR Tesseract | `apps/web/src/lib/ocr/tesseract.ts` |
| Image processing | `apps/web/src/lib/image/` |
| AES crypto | `apps/web/src/lib/crypto/` |
| Scan store (Zustand) | `apps/web/src/stores/scan-store.ts` |
| Navigation lock store | `apps/web/src/stores/navigation-lock-store.ts` |
| PWA manifest | `apps/web/src/app/manifest.ts` |
| Native bridge | `apps/web/src/lib/native-bridge.ts` |

## Web App — Layout Components

| Component | Path |
|-----------|------|
| MobileShell | `apps/web/src/components/layout/mobile-shell.tsx` |
| Header | `apps/web/src/components/layout/header.tsx` |
| BottomNav | `apps/web/src/components/layout/bottom-nav.tsx` |
| ListToolbar | `apps/web/src/components/layout/list-toolbar.tsx` |
| AuthProvider | `apps/web/src/components/layout/consent-gate.tsx` |
| SW Update Notifier | `apps/web/src/components/layout/sw-update-notifier.tsx` |

## Web App — Pages Overview

| Feature | Page Entry | Key Components |
|---------|-----------|----------------|
| Words list | `apps/web/src/app/(app)/words/page.tsx` | SwipeableWordCard, WordSearch |
| Word create | `apps/web/src/app/(app)/words/create/page.tsx` | WordForm |
| Word detail | `apps/web/src/app/(app)/words/[id]/page.tsx` | — |
| Word scan | `apps/web/src/app/(app)/words/scan/page.tsx` | ImageCapture, WordPreview |
| Wordbooks list | `apps/web/src/app/(app)/wordbooks/page.tsx` | WordbookCard |
| Wordbook detail | `apps/web/src/app/(app)/wordbooks/[id]/page.tsx` | — |
| Wordbook add words | `apps/web/src/app/(app)/wordbooks/[id]/add-words/page.tsx` | WordSearch |
| Wordbook practice | `apps/web/src/app/(app)/wordbooks/[id]/practice/page.tsx` | PracticeFlashcard |
| Browse wordbooks | `apps/web/src/app/(app)/wordbooks/browse/page.tsx` | WordbookCard |
| Quiz | `apps/web/src/app/(app)/quiz/page.tsx` | Flashcard, SessionReport |
| Mastered words | `apps/web/src/app/(app)/mastered/page.tsx` | WordCard |
| Settings | `apps/web/src/app/(app)/settings/page.tsx` | — |
| Quiz settings | `apps/web/src/app/(app)/settings/quiz/page.tsx` | — |
| Quiz stats | `apps/web/src/app/(app)/settings/quiz-stats/page.tsx` | — |
| Achievements | `apps/web/src/app/(app)/settings/achievements/page.tsx` | — |

## Web App — Domain Components

| Component | Path |
|-----------|------|
| WordCard | `apps/web/src/components/word/word-card.tsx` |
| SwipeableWordCard | `apps/web/src/components/word/swipeable-word-card.tsx` |
| WordForm | `apps/web/src/components/word/word-form.tsx` |
| WordSearch | `apps/web/src/components/word/word-search.tsx` |
| WordbookCard | `apps/web/src/components/wordbook/wordbook-card.tsx` |
| WordbookForm | `apps/web/src/components/wordbook/wordbook-form.tsx` |
| ImportWordbookDialog | `apps/web/src/components/wordbook/import-wordbook-dialog.tsx` |
| Flashcard (SRS) | `apps/web/src/components/quiz/flashcard.tsx` |
| PracticeFlashcard | `apps/web/src/components/quiz/practice-flashcard.tsx` |
| SessionReport | `apps/web/src/components/quiz/session-report.tsx` |
| ImageCapture | `apps/web/src/components/scan/image-capture.tsx` |
| WordPreview | `apps/web/src/components/scan/word-preview.tsx` |
| WordConfirm | `apps/web/src/components/scan/word-confirm.tsx` |
| ScanComplete | `apps/web/src/components/scan/scan-complete.tsx` |

## Web App — API Routes

| Route | Path |
|-------|------|
| Dictionary lookup | `apps/web/src/app/api/dictionary/route.ts` |
| OCR Vision | `apps/web/src/app/api/ocr/vision/route.ts` |

## Types

| Type | Path |
|------|------|
| Word, StudyProgress | `apps/web/src/types/word.ts` |
| Wordbook | `apps/web/src/types/wordbook.ts` |
| Quiz types | `apps/web/src/types/quiz.ts` |

## Scan/OCR System

| Purpose | Path |
|---------|------|
| Scan store (background extraction) | `apps/web/src/stores/scan-store.ts` |
| OCR extraction pipeline | `apps/web/src/lib/ocr/extract.ts` |
| Tesseract worker | `apps/web/src/lib/ocr/tesseract.ts` |
| LLM Vision OCR | `apps/web/src/lib/ocr/llm-vision.ts` |
| Image processing | `apps/web/src/lib/image/` |

## Quiz/SRS System

| Purpose | Path |
|---------|------|
| Quiz session store | `apps/web/src/lib/quiz/session-store.ts` |
| Achievement definitions | `apps/web/src/lib/quiz/achievement-defs.ts` |
| Achievement logic | `apps/web/src/lib/quiz/achievements.ts` |

## Mobile App (Expo)

| Purpose | Path |
|---------|------|
| App entry | `apps/mobile/index.ts` |
| Root layout | `apps/mobile/src/app/_layout.tsx` |
| WebView home | `apps/mobile/src/app/index.tsx` |
| WebView component | `apps/mobile/src/components/webview/app-webview.tsx` |
| Bridge types | `apps/mobile/src/types/bridge.ts` |
| Expo config | `apps/mobile/app.json` |
| EAS config | `apps/mobile/eas.json` |
| Metro config | `apps/mobile/metro.config.js` |

## Database

| Purpose | Path |
|---------|------|
| Supabase migrations | `supabase/migrations/` |
| Dexie (IndexedDB) schema | `apps/web/src/lib/db/dexie.ts` |

## Tests

| Type | Path |
|------|------|
| E2E tests | `apps/web/e2e/` |
| E2E fixtures | `apps/web/e2e/fixtures/` |
