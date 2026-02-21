# nihongo-vocabook Project Plan

## Context

Japanese vocabulary web app for personal study. Mobile-first web app with Supabase auth, dual storage (Supabase DB for authenticated users, IndexedDB for guests), dictionary lookup via Jisho API, and spaced repetition quiz.

## Tech Stack

| Category | Choice |
|----------|--------|
| Framework | Next.js (App Router) |
| Language | TypeScript (strict) |
| UI | shadcn/ui + Tailwind CSS |
| Auth | Supabase Auth (`@supabase/ssr`) |
| DB (auth) | Supabase Postgres |
| DB (guest) | IndexedDB via Dexie.js |
| State | Zustand (global + local store w/ Context) |
| Japanese input | WanaKana (romaji → kana) |
| Dictionary | Jisho API (free, via Next.js API route proxy) |
| Testing | Vitest + React Testing Library + Playwright |
| Package manager | bun |
| Node | 24 |

## Layout Strategy

- **Mobile-first**: All UI designed for mobile viewport (max-width ~480px)
- **Desktop**: Centered container with max-width, mobile UI preserved (like DailyShot pattern)
- **Bottom navigation**: Tab bar for main sections (Words, Quiz, Settings)
- **Top header**: Page title + contextual actions

```
Desktop:
┌──────────────────────────────────────────┐
│            (gray/neutral bg)             │
│   ┌────────────────────────┐             │
│   │  ┌──────────────────┐  │             │
│   │  │   Header (title)  │  │             │
│   │  ├──────────────────┤  │             │
│   │  │                  │  │             │
│   │  │   Content Area   │  │  max-w-md  │
│   │  │   (480px max)    │  │  (448px)   │
│   │  │                  │  │             │
│   │  ├──────────────────┤  │             │
│   │  │  Bottom Tab Bar  │  │             │
│   │  └──────────────────┘  │             │
│   └────────────────────────┘             │
└──────────────────────────────────────────┘
```

## Directory Structure

```
nihongo-vocabook/
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # Root layout (providers, mobile shell)
│   │   ├── page.tsx                    # Landing page (SSG, SEO)
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   ├── api/
│   │   │   └── dictionary/route.ts     # Jisho API proxy
│   │   └── (app)/                      # App route group (with bottom nav)
│   │       ├── layout.tsx              # App shell (header + bottom nav)
│   │       ├── words/
│   │       │   ├── page.tsx            # Word list
│   │       │   ├── new/page.tsx        # Add word
│   │       │   └── [id]/page.tsx       # Word detail/edit
│   │       ├── quiz/
│   │       │   └── page.tsx            # Flashcard quiz
│   │       └── settings/
│   │           └── page.tsx            # Settings, import/export
│   ├── components/
│   │   ├── ui/                         # shadcn/ui components
│   │   ├── layout/
│   │   │   ├── mobile-shell.tsx        # Centered container wrapper
│   │   │   ├── header.tsx
│   │   │   └── bottom-nav.tsx
│   │   ├── word/
│   │   │   ├── word-card.tsx           # Word display (kanji + reading + meaning)
│   │   │   ├── word-form.tsx           # Add/edit form with WanaKana
│   │   │   └── word-search.tsx         # Dictionary search (Jisho)
│   │   └── quiz/
│   │       └── flashcard.tsx           # Flashcard component
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts              # Browser client
│   │   │   ├── server.ts              # Server client
│   │   │   └── middleware.ts           # Auth middleware
│   │   ├── db/
│   │   │   └── dexie.ts               # Dexie schema + instance
│   │   ├── repository/
│   │   │   ├── types.ts               # Repository interface
│   │   │   ├── supabase-repo.ts       # Supabase implementation
│   │   │   ├── indexeddb-repo.ts       # IndexedDB implementation
│   │   │   └── provider.tsx           # RepositoryProvider (switches by auth)
│   │   ├── dictionary/
│   │   │   └── jisho.ts               # Jisho API client
│   │   ├── migration/
│   │   │   └── migrate-to-supabase.ts # IndexedDB → Supabase migration
│   │   └── spaced-repetition.ts       # SM-2 algorithm
│   ├── stores/
│   │   ├── create-local-store.ts      # Local store utility (Context + createStore)
│   │   ├── auth-store.ts              # Global: auth state
│   │   └── word-store.ts              # Example: word list store
│   └── types/
│       └── word.ts                    # Shared types
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── e2e/                               # Playwright E2E tests
├── next.config.ts
├── tailwind.config.ts
├── vitest.config.ts
└── package.json
```

## Database Schema

### Supabase (Postgres)

```sql
-- Words table
create table words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  term text not null,              -- Japanese (kanji or kana)
  reading text not null,           -- Yomigana (hiragana)
  meaning text not null,           -- Korean meaning
  part_of_speech text,             -- 품사 (noun, verb, adj, etc)
  notes text,
  tags text[] default '{}',
  jlpt_level smallint,             -- N5=5, N4=4, ..., N1=1
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Study progress (spaced repetition)
create table study_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  word_id uuid references words(id) on delete cascade not null,
  next_review timestamptz default now(),
  interval_days real default 0,
  ease_factor real default 2.5,
  review_count int default 0,
  last_reviewed_at timestamptz,
  unique (user_id, word_id)
);

-- RLS policies
alter table words enable row level security;
alter table study_progress enable row level security;

create policy "Users can CRUD own words"
  on words for all using (auth.uid() = user_id);

create policy "Users can CRUD own progress"
  on study_progress for all using (auth.uid() = user_id);
```

### IndexedDB (Dexie)

```typescript
class VocaBookDB extends Dexie {
  words!: Table<LocalWord>;
  studyProgress!: Table<LocalStudyProgress>;

  constructor() {
    super('nihongo-vocabook');
    this.version(1).stores({
      words: '++id, term, reading, meaning, *tags, jlpt_level, created_at',
      studyProgress: '++id, word_id, next_review',
    });
  }
}
```

## Repository Pattern

```typescript
// types.ts
interface WordRepository {
  getAll(): Promise<Word[]>;
  getById(id: string): Promise<Word | null>;
  search(query: string): Promise<Word[]>;
  create(word: CreateWordInput): Promise<Word>;
  update(id: string, word: UpdateWordInput): Promise<Word>;
  delete(id: string): Promise<void>;
}

interface StudyRepository {
  getProgress(wordId: string): Promise<StudyProgress | null>;
  getDueWords(limit?: number): Promise<WordWithProgress[]>;
  recordReview(wordId: string, quality: number): Promise<void>;  // SM-2
}

interface DataRepository {
  words: WordRepository;
  study: StudyRepository;
  exportAll(): Promise<ExportData>;
  importAll(data: ImportData): Promise<void>;
}
```

```typescript
// provider.tsx
function RepositoryProvider({ children }) {
  const { user } = useAuthStore();

  const repo = useMemo(() =>
    user ? new SupabaseRepository(supabase) : new IndexedDBRepository(db),
    [user]
  );

  return (
    <RepositoryContext.Provider value={repo}>
      {children}
    </RepositoryContext.Provider>
  );
}
```

## Zustand Store Utilities

### Global Store (simple)
```typescript
// auth-store.ts
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));
```

### Local Store Factory
```typescript
// create-local-store.ts
function createLocalStore<T>(initializer: StateCreator<T>) {
  const StoreContext = createContext<StoreApi<T> | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const storeRef = useRef<StoreApi<T>>(null);
    if (!storeRef.current) {
      storeRef.current = createStore(initializer);
    }
    return (
      <StoreContext.Provider value={storeRef.current}>
        {children}
      </StoreContext.Provider>
    );
  }

  function useLocalStore<U>(selector: (state: T) => U): U {
    const store = useContext(StoreContext);
    if (!store) throw new Error('Missing Provider');
    return useStore(store, selector);
  }

  return { Provider, useStore: useLocalStore };
}
```

## Word Input UX (WanaKana + Jisho)

### Flow
```
1. User focuses "search" field
2. WanaKana binds → romaji input becomes kana in real-time
3. On Enter or search button: call /api/dictionary?q=たべる
4. Show candidate list (kanji + reading + English meaning)
5. User taps a candidate → auto-fills:
   - term: 食べる
   - reading: たべる
   - English meaning shown as reference
6. User types Korean meaning manually (Korean IME)
7. Save
```

### Word Card UI
```
┌─────────────────────────┐
│  食べる                  │  ← term (large, bold)
│  たべる                  │  ← reading (smaller, muted)
│  먹다                    │  ← meaning (medium, primary color)
│  #JLPT-N5  #동사         │  ← tags (chips)
└─────────────────────────┘
```

## Data Migration (IndexedDB → Supabase)

- **Trigger**: Signup form submit → check `db.words.count()`
- **If data exists**: `window.confirm('기존에 저장된 단어 N개를 계정에 옮기시겠습니까?')`
- **On confirm**: Read all IndexedDB data → bulk insert to Supabase → clear IndexedDB
- **On cancel**: Create account only, IndexedDB data persists
- **Settings page**: "데이터 마이그레이션" button for later migration

## Spaced Repetition (SM-2)

```typescript
function sm2(quality: number, progress: StudyProgress): StudyProgress {
  // quality: 0-5 (0=forgot, 5=perfect)
  let { easeFactor, intervalDays, reviewCount } = progress;

  if (quality >= 3) {
    if (reviewCount === 0) intervalDays = 1;
    else if (reviewCount === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);
    reviewCount++;
  } else {
    reviewCount = 0;
    intervalDays = 1;
  }

  easeFactor = Math.max(1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  return {
    ...progress,
    easeFactor,
    intervalDays,
    reviewCount,
    nextReview: addDays(new Date(), intervalDays),
    lastReviewedAt: new Date(),
  };
}
```

## Implementation Order

### Phase 1: Project Skeleton
1. `bunx create-next-app` with TypeScript, Tailwind, App Router
2. Initialize shadcn/ui
3. Mobile shell layout (centered container, header, bottom nav)
4. Basic routing structure

### Phase 2: Data Layer
5. Supabase project setup + migration SQL
6. Dexie.js schema
7. Repository interface + both implementations
8. RepositoryProvider

### Phase 3: Auth
9. Supabase auth (login/signup pages)
10. Auth middleware
11. AuthStore (Zustand global)
12. Migration logic (IndexedDB → Supabase on signup)

### Phase 4: Core Features
13. Dictionary API route (Jisho proxy)
14. Word search + add form (WanaKana integration)
15. Word list page
16. Word detail/edit page
17. Word delete

### Phase 5: Quiz
18. SM-2 algorithm
19. Flashcard quiz UI
20. Study progress tracking

### Phase 6: Import/Export
21. CSV/JSON export
22. CSV/JSON import
23. Settings page

### Phase 7: Polish + SEO
24. Landing page (SSG)
25. Meta tags, OG tags
26. Loading states, error boundaries
27. PWA manifest (optional, for home screen install)

### Phase 8: Testing
28. Vitest setup + repository unit tests
29. Component tests (word form, flashcard)
30. Playwright E2E (auth flow, word CRUD, quiz)

## Verification

1. `bun run dev` — app starts without errors
2. Landing page renders with SSG (view source has content)
3. Guest flow: add word via dictionary search → appears in word list → quiz works
4. Auth flow: signup → migration prompt → data in Supabase
5. Login on another device → same data
6. Import/export CSV round-trip
7. `bun run test` — all unit tests pass
8. `bun run test:e2e` — Playwright tests pass
