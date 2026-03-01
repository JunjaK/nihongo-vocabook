# Nihongo VocaBook — Project Overview

Japanese vocabulary study PWA (Progressive Web App).

## Quick Reference

### Keep in mind (important!)
- Documentation (`.md`, code comments, commits) MUST be written in English (reduces token consumption)
- All user-facing text MUST use i18n (`t.scope.key`) — never hardcode strings
- Use `useRepository()` for all data access — never call Supabase/Dexie directly
- Zustand is ONLY for auth state (`src/stores/auth-store.ts`) — everything else is local `useState`
- All pages are client components (`'use client'`) due to interactive requirements
- Icons: Tabler Icons via `src/components/ui/icons.tsx` compatibility layer
- Virtual scroll: `@tanstack/react-virtual` for long word lists
- Animations: custom CSS keyframes with stagger support (cap `--stagger` at 15)
- Style constants: always check `@/lib/styles` first — never repeat raw class strings
- Import paths: MUST verify every import resolves to an actual file before writing

### Type Safety (CRITICAL — Zero Tolerance)
- **Type errors must NEVER be ignored or skipped** — resolve every error before moving on
- **If unsure, ask the user** instead of guessing types or using `any`/`as` casts
- **No `any`, no `unknown`** — always use concrete types
- **Use library/generated types** directly (extend with `Omit`, `Pick`, `Partial`)
- **Inference over annotation** — annotate only when inference is insufficient
- **Explicit parameter types, inferred return** — add return types only for complex/public functions
- **Discriminated unions** for state variants, not loose optionals
- **Type guards** (`is` keyword) for runtime narrowing; `satisfies` for validation without widening
- **Generics** only when reusable; avoid unconstrained `<T>`

## Project Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19 + Tailwind CSS 4 + Shadcn UI (Radix) |
| State | Zustand (auth only), React local state for everything else |
| Data | Repository pattern — Supabase (authenticated) / IndexedDB via Dexie (guest) |
| i18n | Custom context-based (ko/en), no external library |
| Icons | Tabler Icons (`@tabler/icons-react`) via compatibility layer |
| Animations | Custom CSS keyframes with stagger support |
| Theme | OKLCH color space, light/dark via `next-themes` |
| Virtual scroll | `@tanstack/react-virtual` |
| Testing | Vitest + Playwright |

### Commands
```bash
# From repo root (workspace shortcuts)
bun run dev                 # Dev server (web)
bun run build               # Production build (web)
bun run test                # Unit tests (web)
bun run dev:mobile          # Expo dev server (mobile)

# From apps/web/
cd apps/web && bun run dev  # Dev server
cd apps/web && bun test     # Unit tests (Vitest)
cd apps/web && bunx playwright test  # E2E tests
```

## Provider Composition Order

```tsx
ThemeProvider → I18nProvider → AuthProvider → RepositoryProvider → MobileShell
```

Repository auto-selects implementation based on auth state:
- Authenticated → `SupabaseRepository`
- Guest → `IndexedDBRepository`

## Related

**Rules (auto-loaded every conversation):**
- [code-style.md](./code-style.md) — Code ordering, types, i18n, testing
- [codebase-map.md](./codebase-map.md) — Key file paths for quick navigation

**Skills (auto-suggested via hooks when relevant):**
- `page-patterns` — Page development patterns, list layouts, loading, search
- `ui-conventions` — Header actions, buttons, icons, animations, i18n, toasts
- `data-layer` — Repository usage, Supabase/IndexedDB, database migrations
- `quiz-maintainer` — Quiz UI, practice mode, SRS, flashcards, badge counts
- `testing` — Vitest unit tests, Playwright E2E, mocking, test IDs
