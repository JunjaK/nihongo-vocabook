# 日本語 VocaBook

Japanese vocabulary study PWA — Learn, Review, and Share words with spaced repetition.

## Features

- **Dictionary Search** — Look up Japanese words via Jisho dictionary with romaji-to-kana conversion
- **OCR / AI Extraction** — Extract Japanese words from photos using Tesseract.js OCR or LLM Vision
- **Spaced Repetition** — SM-2 algorithm flashcard quiz for efficient memorization
- **Wordbooks** — Organize words into custom collections, share them with others
- **JLPT Wordbooks** — Subscribe to built-in N5–N1 wordbooks
- **Offline Support** — Full guest mode with IndexedDB; no account required
- **Cloud Sync** — Sign up to sync data across devices via Supabase
- **Bilingual UI** — Korean and English interface
- **Dark Mode** — System, light, and dark theme support

## Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS 4, shadcn/ui (Radix) |
| State | Zustand (auth), React local state |
| Database | Supabase (authenticated), IndexedDB via Dexie (guest) |
| OCR | Tesseract.js, LLM Vision (OpenAI / Google) |
| Icons | Lucide React |
| Testing | Vitest, Playwright |
| Deployment | GitHub Actions → Docker (standalone) |

## Getting Started

```bash
# Install dependencies
bun install

# Run development server
bun dev

# Build for production
bun run build

# Run tests
bun test
```

## License

[MIT](LICENSE)
