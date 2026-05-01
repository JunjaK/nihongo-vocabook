---
name: testing
description: |
  Testing patterns for Nihongo VocaBook. Read when writing unit tests (Vitest),
  E2E tests (Playwright), mocking the repository layer, testing React components
  with Testing Library, or working with test IDs and test file conventions.
---

# Testing Patterns

## Stack

| Layer | Tool | Config |
|-------|------|--------|
| Unit | Vitest 4 + jsdom + React Testing Library | `vitest.config.ts` |
| E2E | Playwright | `playwright.config.ts` |
| Assertions | `@testing-library/jest-dom` (unit), Playwright expect (e2e) |

## Commands

```bash
bun run test          # Vitest — run once
bun run test:watch    # Vitest — watch mode
bun run test:e2e      # Playwright — all E2E tests
```

---

## File Naming & Location

| Type | Pattern | Location |
|------|---------|----------|
| Unit test | `*.test.ts` / `*.test.tsx` | Co-located next to source in `src/` |
| E2E (auth required) | `*.spec.ts` | `e2e/` |
| E2E (no auth) | `*.noauth.spec.ts` | `e2e/` |

Unit tests sit next to the file they test:
```
src/lib/repository/
├── supabase-repo.ts
├── supabase-repo.test.ts    ← unit test
├── indexeddb-repo.ts
└── types.ts
```

---

## data-testid Convention

Format: `{page}-{element}-{action}[-{index}]`

Examples:
- `word-form-term`, `word-form-submit`
- `flashcard`, `flashcard-rate-4`, `flashcard-rating`
- `item-card-0`, `login-email-input`

Always use `data-testid` for E2E selectors. Prefer `getByTestId` over CSS selectors.

---

## Unit Tests (Vitest + React Testing Library)

### Mocking the Repository

All components access data through `useRepository()`. Mock at the provider level, never import Supabase/Dexie directly.

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Create a mock repository matching the DataRepository interface
const mockRepo = {
  words: {
    getNonMastered: vi.fn().mockResolvedValue([]),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    search: vi.fn(),
    setPriority: vi.fn(),
    setMastered: vi.fn(),
  },
  study: {
    getDueCount: vi.fn().mockResolvedValue(0),
    getDueWords: vi.fn().mockResolvedValue([]),
    saveReview: vi.fn(),
  },
  wordbooks: {
    getAll: vi.fn().mockResolvedValue([]),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  exportAll: vi.fn(),
  importAll: vi.fn(),
};

// Mock the provider hook
vi.mock('@/lib/repository/provider', () => ({
  useRepository: () => mockRepo,
}));
```

### Mocking i18n

```tsx
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({
    t: new Proxy({}, {
      get: (_target, scope: string) =>
        new Proxy({}, {
          get: (_t, key: string) => `${scope}.${key}`,
        }),
    }),
  }),
}));
```

### Mocking Auth Store

```tsx
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: { user: null }) => unknown) =>
    selector({ user: null }),
}));
```

### Mocking Next.js Router

```tsx
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
  }),
  useParams: () => ({ id: 'test-id' }),
  useSearchParams: () => new URLSearchParams(),
}));
```

### Component Test Structure

```tsx
describe('WordCard', () => {
  const mockWord = {
    id: 'w1',
    term: '食べる',
    reading: 'たべる',
    meaning: 'to eat',
    priority: 0,
    mastered: false,
    created_at: new Date().toISOString(),
  };

  it('renders term and meaning', () => {
    render(<WordCard word={mockWord} />);
    expect(screen.getByText('食べる')).toBeInTheDocument();
    expect(screen.getByText('to eat')).toBeInTheDocument();
  });

  it('calls onDelete when delete button clicked', async () => {
    const onDelete = vi.fn();
    render(<WordCard word={mockWord} onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith('w1');
  });
});
```

### Testing Hooks

```tsx
import { renderHook, act } from '@testing-library/react';

describe('useCustomHook', () => {
  it('updates state correctly', async () => {
    const { result } = renderHook(() => useCustomHook());
    await act(async () => {
      await result.current.doSomething();
    });
    expect(result.current.value).toBe('expected');
  });
});
```

---

## E2E Tests (Playwright)

### Import

Always use `@playwright/test` — never import from `vitest` or other test runners.

```ts
import { test, expect } from '@playwright/test';
```

### Test Structure

```ts
test.describe('Feature name (context)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/words');
    await page.waitForLoadState('networkidle');
  });

  test('descriptive test name', async ({ page }) => {
    // Arrange: set up state
    // Act: interact with page
    // Assert: verify outcomes
  });
});
```

### Common Patterns

**Wait for loading to finish (300ms minimum delay in app):**
```ts
await expect(page.getByTestId('flashcard')).toBeVisible({ timeout: 10000 });
```

**Form interaction (word create):**
The `word-form-term` and `word-form-reading` fields are `readOnly` — they are populated only by selecting a dictionary search result, which also sets the hidden `dictionaryEntryId` that gates submit. Pattern:
```ts
await page.goto('/words/create');
await page.getByTestId('word-search-input').fill('食べる');
await page.getByTestId('word-search-button').click();
await page.getByTestId('word-search-result-0').click();
// term / reading / meaning are now auto-filled. Customize meaning if needed:
await page.getByTestId('word-form-meaning').fill('먹다');
await page.getByTestId('word-form-submit').click();
await page.waitForURL('/words');
```

**Navigation + assertion:**
```ts
await page.goto('/quiz');
await page.waitForLoadState('networkidle');
await expect(page.getByText('食べる')).toBeVisible();
```

**Guest mode setup (IndexedDB):**
Guest mode uses IndexedDB — no auth setup needed. Data is created through the UI in test setup steps.

**Authenticated test setup (Supabase):**
For `*.spec.ts` tests requiring auth, import from `./fixtures/auth` instead of `@playwright/test`. A worker-scoped fixture handles login once per worker (5-account pool: `e2e1@test.com` ~ `e2e5@test.com`) and caches `storageState` under `e2e/.auth/`. To rotate credentials, delete `e2e/.auth/`.

```ts
import { test, expect } from './fixtures/auth';

test.describe('Words (Supabase)', () => {
  test('something requiring auth', async ({ page, workerAccountEmail }) => {
    await page.goto('/words');
    // Already logged in as `workerAccountEmail` (e.g. e2e1@test.com).
  });
});
```

Notes:
- `playwright.config.ts` caps `workers: 5` to match the account pool size.
- Specs sharing an account run in the same worker — Playwright serializes them — so single-account state collisions are bounded to that file's tests.
- Use unique markers (timestamps, parallelIndex) when creating data, since accounts accumulate test garbage across runs.

### Selector Priority

1. `getByTestId('...')` — primary, stable
2. `getByRole('button', { name: '...' })` — for buttons without testid
3. `getByText('...')` — for content assertions
4. Avoid: CSS selectors, XPath

---

## Key Rules

- Mock all API/repository calls in unit tests — never hit real Supabase/IndexedDB.
- Use real components (not stubs) — shallow rendering is discouraged.
- E2E tests interact through the UI only — never directly call APIs or manipulate state.
- Keep tests independent — no shared mutable state between tests.
- Prefer `userEvent` over `fireEvent` in unit tests for realistic interaction simulation.
