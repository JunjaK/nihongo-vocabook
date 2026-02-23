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

## Style Constants (`src/lib/styles.ts`)

All common layout class strings are centralized in `@/lib/styles`. **Never write raw repeated Tailwind strings** — always import the constant.

```tsx
import { pageWrapper, scrollArea, bottomBar, bottomSep, listContainer } from '@/lib/styles';
```

Key constants: `pageWrapper`, `scrollArea`, `bottomBar`, `bottomSep`, `listContainer`, `listGap`, `tabsBar`, `inlineSep`, `toolbarRow`, `skeletonWordList`, `skeletonCardList`, `emptyState`, `emptyIcon`, `settingsScroll`, `settingsSection`, `settingsHeading`, `settingsNavLink`.

Use `cn()` from `@/lib/utils` when combining with overrides: `cn(scrollArea, 'p-4')`.

---

## Bottom Fixed Button Pattern

All primary action buttons at the bottom of a page/step MUST use the bottom fixed pattern. This keeps the button always visible regardless of scroll position.

**Required structure:**

```tsx
import { pageWrapper, scrollArea, bottomBar, bottomSep } from '@/lib/styles';

<div className={pageWrapper}>
  <div className={scrollArea}>
    {/* ... content ... */}
  </div>

  {/* Fixed bottom button — OUTSIDE the scrollable area */}
  <div className={bottomBar}>
    <div className={bottomSep} />
    <Button className="w-full" ...>Action</Button>
  </div>
</div>
```

**Rules:**
- Bottom bar: `bottomBar` constant (`shrink-0 bg-background px-4 pb-3`)
- Separator: `bottomSep` constant (`mb-3 h-px bg-border`)
- The button container is a **sibling** of the scrollable content, never nested inside it
- The parent container must use `pageWrapper` (`flex min-h-0 flex-1 flex-col`)
- Applies to: forms, wizard steps, detail pages with action buttons, confirmation dialogs

---

## Page Component Order

Every page component MUST follow this hook/state ordering:

```tsx
'use client';

export default function SomePage() {
  // 1. Framework hooks
  const { id } = use(params);          // route params
  const router = useRouter();

  // 2. Global stores
  const repo = useRepository();
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation();

  // 3. Local state
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');

  // 4. Refs
  const loadStart = useRef(0);
  const parentRef = useRef<HTMLDivElement>(null);

  // 5. Data fetching callbacks
  const loadData = useCallback(async () => { ... }, [repo]);

  // 6. Effects
  useEffect(() => { loadData(); }, [loadData]);

  // 7. Derived state
  const filteredItems = appliedQuery ? items.filter(...) : items;

  // 8. Event handlers
  const handleSearch = () => { ... };
  const handleDelete = async (id: string) => { ... };

  // 9. JSX return
  return ( ... );
}
```

---

## List Page Pattern

Standard structure for pages that display a list of items:

```
┌──────────────────────┐
│ Header (sticky)      │  ← title + icon action buttons (ghost, icon-sm)
├──────────────────────┤
│ ListToolbar (sticky) │  ← search + reading/meaning toggles + sort
├──────────────────────┤
│                      │
│ Virtual scroll list  │  ← flex-1 overflow-y-auto
│ or space-y-2 list    │
│                      │
├──────────────────────┤
│ ── separator ──      │
│ [  Primary Action  ] │  ← bottom fixed button (shrink-0)
└──────────────────────┘
```

- Header actions: icon buttons (`variant="ghost" size="icon-sm"`) for secondary actions
- Bottom fixed button: primary action (create, add, etc.)
- Loading state: centered spinner + text
- Empty state: centered icon + message, different text for search vs initial
- Virtual scroll: use `@tanstack/react-virtual` for lists > ~50 items

---

## Loading Pattern (Minimum Delay)

All data-loading pages MUST enforce a 300ms minimum load time to prevent flash:

```tsx
const loadStart = useRef(0);

const loadData = useCallback(async () => {
  setLoading(true);
  loadStart.current = Date.now();
  try {
    const data = await repo.words.getNonMastered();
    setItems(data);
  } finally {
    const remaining = 300 - (Date.now() - loadStart.current);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    setLoading(false);
  }
}, [repo]);
```

---

## Search Pattern (Dual State)

Search bars MUST use two state variables — never filter on every keystroke:

```tsx
const [searchInput, setSearchInput] = useState('');     // bound to input
const [appliedQuery, setAppliedQuery] = useState('');   // triggers actual filter

const handleSearch = () => setAppliedQuery(searchInput.trim());
const handleSearchClear = () => { setSearchInput(''); setAppliedQuery(''); };
```

---

## Animation Patterns

**Staggered list items:**
```tsx
{items.map((item, i) => (
  <div
    key={item.id}
    className="animate-stagger"
    style={{ '--stagger': Math.min(i, 15) } as React.CSSProperties}
  >
    <ItemCard ... />
  </div>
))}
```

**Available animation classes:** `animate-fade-in`, `animate-slide-up`, `animate-stagger`, `animate-page`

---

## i18n Conventions

- Access: `const { t } = useTranslation();` → `t.scope.key`
- Types: `/src/lib/i18n/types.ts` — `Translations` interface
- Files: `en.ts`, `ko.ts` implementing `Translations`
- Key format: `scope.camelCaseKey` (e.g. `t.words.searchPlaceholder`)
- Parametric: `(n: number) => string` for plurals/interpolation
- Korean quoted text: corner brackets `「」`
- ALL user-facing strings must go through i18n — no hardcoded text

---

## Toast Notifications

Use `sonner` for all user feedback:

```tsx
import { toast } from 'sonner';

toast.success(t.words.wordAdded);     // success
toast.error(t.settings.importError);  // error
toast.info(t.settings.noLocalData);   // info
```

---

## Header Actions Convention

**Rule: Header actions MUST be icon-only buttons** (`variant="ghost" size="icon-sm"` + `aria-label`). No text buttons in the header actions area.

| Page type | Header action (icons) | Bottom button |
|-----------|----------------------|---------------|
| Words list | Scan icon → `/words/scan` | Add Word → `/words/new` |
| Wordbooks list | Download icon → `/wordbooks/browse` | Create Wordbook → `/wordbooks/new` |
| Wordbook detail (owned) | Edit (Pencil) | Add Words (outline) + Start Quiz (primary) |
| Wordbook detail (subscribed) | Unsubscribe (Link2Off) | Start Quiz |
| Wordbook edit | Delete (Trash2) + Cancel (X) | Save (form submit) |
| Word detail | Edit, Delete | — |

---

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
