# Code Style

## Code Ordering (Required)

**MUST follow this order** in every component, hook, and store:

```tsx
function MyComponent() {
  // 1. Framework hooks (routing, i18n)
  const params = use(props.params);
  const t = useTranslation();

  // 2. Global stores
  const { user } = useAuth();

  // 3. Page-specific stores (if any)

  // 4. Data fetching (repository)
  const repo = useRepository();

  // 5. Local state + derived
  const [items, setItems] = useState<Word[]>([]);
  const filteredItems = useMemo(() => items.filter(...), [items]);

  // 6. Refs
  const parentRef = useRef<HTMLDivElement>(null);

  // 7. Side effects / watchers
  useEffect(() => { loadData(); }, []);

  // 8. Handler functions
  function handleSubmit() { ... }

  // 9. Return / JSX
  return <div>...</div>;
}
```

---

## Type Safety (CRITICAL)

### Zero Tolerance for Type Errors
- **Type errors must NEVER be ignored or skipped.** Every type error must be resolved before moving on.
- If a type error cannot be resolved, **ask the user** instead of guessing or using `any`/`as` casts.
- After writing or modifying code, **always verify types** by checking for TypeScript errors in the affected files.

### Type Definitions
```ts
// Use library types directly
import type { Word, Wordbook } from '@/types/word';

// Extend when needed
interface ExtendedWord extends Omit<Word, 'tags'> {
  tags: string[];
  isSelected: boolean;
}

// No any, no unknown — always concrete types
// No inline import() types — use proper imports at file top
// Inference over annotation — annotate only when needed
```

---

## i18n

### Required: All user-facing text must use i18n
```tsx
// Access translations via useTranslation() hook
const t = useTranslation();

// Usage: t.scope.key
t.common.save           // "Save"
t.words.title           // "My Words"
t.quiz.reviewed(5)      // "5 words reviewed" (parametric)

// Never hardcode user-facing text
<span>{t.words.noWords}</span>      // ✅
<span>No words yet</span>           // ❌
```

### Key Format
```ts
// kebab-case-scope.snake_case_key in types.ts
common: { loading: string; save: string; }
words: { title: string; no_words: string; }
```

### Quotation Marks in Korean Text
Always use corner brackets (`「」`) to avoid JSON conflicts:
```ts
'「데이터 동기화」 버튼을 클릭해주세요.'  // ✅ U+300C, U+300D
'"데이터 동기화" 버튼을 클릭해주세요.'    // ❌ JSON conflict
```

---

## data-testid Attributes

### Naming Convention
```
{page}-{element}-{action}[-{index}]
```

**Examples:**
```tsx
data-testid="words-search-input"
data-testid="word-card-0"
data-testid="quiz-start-button"
data-testid="wordbook-create-submit"
data-testid="settings-language-select"
```

### When to Add
- Buttons (submit, create, delete)
- Form inputs (text, select, checkbox)
- Clickable cards or list items
- Modal triggers and action buttons
- Navigation elements

---

## Import Path Rules (CRITICAL)

**MUST verify that every import path resolves to an actual file before writing it.**

```ts
// ✅ Alias paths for cross-module imports
import { Word } from '@/types/word';
import { useRepository } from '@/lib/repository/provider';
import { styles } from '@/lib/styles';

// ✅ Relative paths for same-directory files
import { WordCard } from './word-card';

// ❌ NEVER write import paths without verifying they resolve
import { useFoo } from '@/lib/wrong-path';  // path doesn't exist!
```

When adding or modifying imports:
1. **Check the target file exists** (use Glob/Read to confirm)
2. **Check existing imports** in the file and nearby files for the correct path pattern
