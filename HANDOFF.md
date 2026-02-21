# Nihongo VocaBook - Handoff

## Current Status

Phase 1-7 code written. Build error remains — needs fix before dev server works.

## Completed Work

### Phase 1: Project Skeleton
- `bun create next-app` with TypeScript, Tailwind, App Router
- shadcn/ui initialized + components: button, card, input, label, badge, separator, scroll-area, sonner
- Dependencies: `@supabase/supabase-js`, `@supabase/ssr`, `dexie`, `zustand`, `wanakana`, `sonner`
- Dev deps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@vitejs/plugin-react`, `jsdom`
- Full directory structure created
- Layout components: `mobile-shell.tsx`, `header.tsx`, `bottom-nav.tsx`, `auth-provider.tsx`
- Root layout with providers, App layout with bottom nav

### Phase 2: Data Layer
- `src/types/word.ts` — all shared types
- `src/lib/db/dexie.ts` — Dexie schema
- `src/lib/repository/types.ts` — repository interface
- `src/lib/repository/indexeddb-repo.ts` — IndexedDB implementation
- `src/lib/repository/supabase-repo.ts` — Supabase implementation
- `src/lib/repository/provider.tsx` — RepositoryProvider (switches by auth)
- `supabase/migrations/001_initial_schema.sql`

### Phase 3: Auth
- `src/lib/supabase/client.ts`, `server.ts`, `middleware.ts`
- `src/middleware.ts` — auth middleware
- `src/stores/auth-store.ts` — Zustand global auth store
- `src/app/login/page.tsx`, `src/app/signup/page.tsx` (with migration prompt)
- `src/lib/migration/migrate-to-supabase.ts`

### Phase 4: Core Features
- `src/app/api/dictionary/route.ts` — Jisho API proxy
- `src/lib/dictionary/jisho.ts` — client-side dictionary search
- `src/components/word/word-search.tsx` — WanaKana + Jisho search
- `src/components/word/word-form.tsx` — add/edit form
- `src/components/word/word-card.tsx` — word display card
- `src/app/(app)/words/page.tsx` — word list
- `src/app/(app)/words/new/page.tsx` — add word
- `src/app/(app)/words/[id]/page.tsx` — word detail/edit/delete

### Phase 5: Quiz
- `src/lib/spaced-repetition.ts` — SM-2 algorithm
- `src/components/quiz/flashcard.tsx` — flashcard component
- `src/app/(app)/quiz/page.tsx` — quiz page

### Phase 6: Import/Export + Settings
- `src/app/(app)/settings/page.tsx` — settings with export JSON/CSV, import, migration, logout

### Phase 7: Landing + SEO
- `src/app/page.tsx` — landing page

### Other
- `src/stores/create-local-store.ts` — local store factory
- `vitest.config.ts`
- `.env.local.example`, `.env.local` (placeholder values)

## Known Build Error

`src/stores/create-local-store.ts` — Context Provider type error with React 19 generics.

Latest code assigns `StoreContext.Provider` to a `Ctx` variable as a workaround. Build verification needed:

```bash
bun run build
```

Fix `create-local-store.ts` if error persists.

## Remaining Work

1. Fix build error — `bun run build` must pass
2. Next.js middleware deprecation warning — `middleware.ts` to `proxy` migration (warning only, still works)
3. Unit tests — `src/**/*.test.ts` (SM-2 algorithm, repository, etc.)
4. E2E tests — Playwright setup + `e2e/*.spec.ts`
5. Replace `.env.local` placeholder values with real Supabase project keys

## How to Continue

```bash
cd /Users/jun/develop/personal/nihongo-vocabook
bun run build    # check and fix build errors
bun run dev      # start dev server
```
