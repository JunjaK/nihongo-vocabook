---
name: data-layer
description: |
  Data layer patterns for Nihongo VocaBook. Read when working with the repository pattern,
  Supabase, IndexedDB/Dexie, database migrations, data fetching from components, or
  modifying the DataRepository interface.
---

# Data Layer

## Repository Pattern

```
useRepository() → DataRepository
  ├── .words: WordRepository     (CRUD, search, mastered)
  ├── .study: StudyRepository    (progress, due words, review)
  ├── .wordbooks: WordbookRepository (CRUD, share, subscribe)
  ├── .exportAll()
  └── .importAll()
```

Never call Supabase or Dexie directly from components — always go through `useRepository()`.

Repository auto-selects implementation based on auth state:
- Authenticated → `SupabaseRepository` (`src/lib/repository/supabase-repo.ts`)
- Guest → `IndexedDBRepository` (`src/lib/repository/indexeddb-repo.ts`)
- Interface: `src/lib/repository/types.ts`
- Provider: `src/lib/repository/provider.tsx`

---

## Database Migrations

Migration files live in `supabase/migrations/` with naming convention `NNN_description.sql` (e.g. `009_quiz_upgrade.sql`).

### Running Migrations

```bash
bun run scripts/run-migrations.ts
```

- Reads `NEXT_PRIVATE_SUPABASE_DB_LINK_SESSION` from `.env.local`
- Runs all migrations in order; skips already-applied ones (`already exists` / `duplicate`)
- Uses the `postgres` package (NOT `pg`)

### Adding a New Migration

1. Create `supabase/migrations/NNN_description.sql`
2. Add the filename to the `migrations` array in `scripts/run-migrations.ts`
3. Run `bun run scripts/run-migrations.ts`
