# Nihongo VocaBook — Project Instructions

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **UI**: React 19 + Tailwind CSS 4 + Shadcn UI (Radix)
- **State**: Zustand (auth only), React local state for everything else
- **Data**: Repository pattern — Supabase (authenticated) / IndexedDB via Dexie (guest)
- **i18n**: Custom context-based (ko/en), no external library
- **Icons**: Lucide React (`lucide-react`)
- **Animations**: Custom CSS keyframes with stagger support
- **Theme**: OKLCH color space, light/dark via `next-themes`
- **Virtual scroll**: `@tanstack/react-virtual`
- **Testing**: Vitest + Playwright

## Project Structure

```
src/
├── app/
│   ├── (app)/           # Authenticated routes (with BottomNav)
│   │   ├── words/       # Word CRUD, scan
│   │   ├── wordbooks/   # Wordbook CRUD, browse, add-words
│   │   ├── quiz/        # Flashcard quiz
│   │   ├── mastered/    # Mastered words list
│   │   └── settings/    # Settings, OCR config, profile
│   ├── api/             # Route handlers (dictionary, OCR, profile)
│   ├── login/
│   ├── signup/
│   └── verify-email/
├── components/
│   ├── ui/              # Shadcn primitives (button, input, card, etc.)
│   ├── layout/          # Header, BottomNav, MobileShell, AuthProvider, ListToolbar
│   ├── word/            # WordCard, WordForm, SwipeableWordCard
│   ├── wordbook/        # WordbookCard, WordbookForm, AddToWordbookDialog
│   ├── quiz/            # Flashcard
│   └── scan/            # ImageCapture, WordPreview, WordConfirm, ScanComplete
├── lib/
│   ├── i18n/            # Translations (types.ts, en.ts, ko.ts, index.tsx)
│   ├── repository/      # DataRepository interface + Supabase/IndexedDB impls
│   ├── supabase/        # Supabase client helpers
│   ├── ocr/             # Tesseract + LLM Vision extraction
│   ├── crypto/          # AES encryption for API keys
│   ├── profile/         # Profile fetch helpers
│   └── spaced-repetition.ts  # SM-2 algorithm
├── stores/              # Zustand — auth-store only
└── types/               # Word, Wordbook, StudyProgress interfaces
```

## Provider Composition Order

```tsx
ThemeProvider → I18nProvider → AuthProvider → RepositoryProvider → MobileShell
```

Repository auto-selects implementation based on auth state:
- Authenticated → `SupabaseRepository`
- Guest → `IndexedDBRepository`

---

## Skills (Progressive Disclosure)

Detailed patterns are split into skill files. Read the relevant skill when working on that area.

| Area | Skill File | When to Read |
|------|-----------|--------------|
| Page development | `.claude/skills/page-patterns/SKILL.md` | Creating/modifying pages, list layouts, loading states, search bars, bottom buttons, style constants |
| UI conventions | `.claude/skills/ui-conventions/SKILL.md` | Header actions, buttons, icons, animations, i18n, toast notifications |
| Data layer | `.claude/skills/data-layer/SKILL.md` | Repository usage, Supabase/IndexedDB, database migrations |
| Quiz/Practice | `.claude/skills/quiz-maintainer/SKILL.md` | Quiz UI, practice mode, SRS, flashcards, badge counts, session behavior |
| Testing | `.claude/skills/testing/SKILL.md` | Unit tests (Vitest), E2E tests (Playwright), mocking repository/i18n/auth, test ID conventions |
