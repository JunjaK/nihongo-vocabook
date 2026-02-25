---
name: page-patterns
description: |
  Page development patterns for Nihongo VocaBook. Read when creating or modifying page
  components, implementing list pages, adding loading states, search bars, bottom fixed
  buttons, or working with style constants and scroll areas.
---

# Page Development Patterns

## Style Constants (`src/lib/styles.ts`)

All common layout class strings are centralized in `@/lib/styles`. Never write raw repeated Tailwind strings — always import the constant.

```tsx
import { pageWrapper, scrollArea, bottomBar, bottomSep, listContainer } from '@/lib/styles';
```

Key constants: `pageWrapper`, `scrollArea`, `bottomBar`, `bottomSep`, `listContainer`, `listGap`, `tabsBar`, `inlineSep`, `toolbarRow`, `skeletonWordList`, `skeletonCardList`, `emptyState`, `emptyIcon`, `settingsScroll`, `settingsSection`, `settingsHeading`, `settingsNavLink`.

Use `cn()` from `@/lib/utils` when combining with overrides: `cn(scrollArea, 'p-4')`.

---

## Bottom Fixed Button Pattern

All primary action buttons at the bottom of a page/step MUST use the bottom fixed pattern.

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

### Bottom Button Layout: Horizontal, Never Vertical

When there are multiple buttons in the bottom bar, they MUST be **horizontal** (`flex gap-2`), never vertical (`flex-col`).

```tsx
// ✅ Correct — horizontal layout, secondary left, primary right
<div className={bottomBar}>
  <div className={bottomSep} />
  <div className="flex gap-2">
    <Button variant="outline" className="flex-1">Secondary</Button>
    <Button className="flex-1">Primary</Button>
  </div>
</div>

// ❌ Wrong — vertical stacking
<div className="flex flex-col gap-2">
  <Button className="w-full">Primary</Button>
  <Button variant="outline" className="w-full">Secondary</Button>
</div>
```

**Button order (L→R):** secondary (outline) → primary. Rightmost = primary action.
**Sizing:** Each button gets `flex-1` (not `w-full`).
**Single button:** Use `className="w-full"` (no flex container needed).

---

## State Screen Patterns (Empty / Error / Not Found)

All full-page state screens (empty, not-found, error, completion) MUST be vertically + horizontally centered using the `emptyState` constant.

### Full-page state (replaces scroll area)

```tsx
// ✅ Correct — uses emptyState constant for centering
import { emptyState, emptyIcon } from '@/lib/styles';

<div className={emptyState}>
  <BookOpen className={emptyIcon} />
  {t.words.noWords}
</div>

// ❌ Wrong — py-8 text-center is NOT vertically centered
<div className="py-8 text-center text-muted-foreground">
  {t.words.wordNotFound}
</div>
```

### "No results" inside a scroll container

When the empty state is rendered **inside** an existing scroll area (e.g., search returns 0 results but the parent scroll container must persist), use `min-h-full` centering:

```tsx
<div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto">
  {filteredWords.length === 0 ? (
    // ✅ Centered within scroll area
    <div className="flex min-h-full items-center justify-center text-center text-muted-foreground">
      {t.words.noWords}
    </div>
  ) : (
    // ... virtual list ...
  )}
</div>
```

### Completion screen (e.g., scan complete)

Completion screens use `scrollArea` + internal centering:

```tsx
<div className={scrollArea}>
  <div className="animate-page flex flex-1 flex-col items-center justify-center gap-6">
    <CheckIcon className="size-16 text-green-500" />
    <div className="text-center">...</div>
  </div>
</div>
```

---

## Style Constant Enforcement

**NEVER write raw Tailwind strings when a style constant exists.** Common violations:

| Raw Tailwind (wrong) | Style Constant (correct) |
|-----------------------|--------------------------|
| `"flex min-h-0 flex-1 flex-col"` | `pageWrapper` |
| `"flex-1 overflow-y-auto"` | `scrollArea` |
| `"shrink-0 bg-background px-4 pb-3"` | `bottomBar` |
| `"mb-3 h-px bg-border"` | `bottomSep` |
| `"animate-page flex-1 space-y-2 overflow-y-auto px-4 pt-2"` | `skeletonWordList` |
| `"animate-page flex-1 space-y-2 overflow-y-auto p-4"` | `skeletonCardList` |
| `"py-8 text-center text-muted-foreground"` (for state screens) | `emptyState` |

**Use `cn()` when adding modifiers:**
```tsx
<div className={cn(scrollArea, 'min-h-0 p-4')}>
```

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

Execute on Enter or button click only (NOT per keystroke). Reset clears both.
