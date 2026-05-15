# UI Renewal Plan — Based on design/conceptWithVariable.pen

> Status: In Progress (Phase 1-4 complete, visual verification pending)

## Context

Renew the entire web app UI to match the design file `design/conceptWithVariable.pen`. The design has ~50 screens (light + dark) across 22 pages, a style guide with typography/spacing/radius/color definitions, and 23 reusable components.

**Key decisions:**
- Keep Tabler Icons (match visual intent, don't switch to Phosphor)
- Convert design hex colors → OKLCH equivalents for CSS variables
- Light mode first → then dark mode
- Foundation first (tokens + components) → then page-by-page
- i18n: default locale already `ko` — .pen has English text which maps to i18n keys

---

## Design Reference (from .pen Style Guide)

### Typography (Zen Kaku Gothic New — already imported)
| Role | Size | Weight | Tracking |
|------|------|--------|----------|
| Page Title | 28px | 700 | -0.5 |
| Section Header | 18px | 600 | — |
| Body Text | 15px | 400 | — |
| Caption / Label | 13px | 500 | — |
| Overline | 11px | 600 | +2, uppercase |
| Kanji Display | 36px | 500 | — |
| Reading (furigana) | 14px | 400 | — |
| Badge / Metric | 12px | 500 | — |

### Spacing Scale
4px (icon gaps) → 8px (inner padding) → 12px (card padding) → 16px (list gaps) → 20px (page horizontal padding) → 24px (section gaps) → 32px (major section gaps)

### Corner Radius
0 (dividers) → 4 (badges, chips) → 8 (buttons, inputs) → 12 (cards, list items) → 16 (modals, bottom sheets) → full (avatars, pill nav)

### Color Palette (hex → CSS variable mapping)
**Light mode key colors:**
- bg-primary: #FFFFFF, bg-secondary: #F5F5F5, bg-tertiary: #EBEBEB
- text-primary: #0A0A0A, text-secondary: #6B6B6B, text-tertiary: #ABABAB
- primary: #3D5A80, accent: #1B2E4A, accent-light: #E8EDF4
- border: #E5E5E5, border-strong: #D0D0D0
- destructive: #EF4444, success: #22C55E, warning: #F59E0B

---

## Phase 1: Foundation — Design Tokens & Colors (Light Mode)

### 1.1 CSS Variable Migration
**File: `apps/web/src/app/globals.css`**

Replace the `:root` OKLCH values with OKLCH equivalents of the design's hex colors:

| CSS Variable | Current (OKLCH) | Target Hex | New OKLCH (computed) |
|---|---|---|---|
| --background | oklch(0.976 0.011 112.6) warm off-white | #FFFFFF | oklch(1 0 0) |
| --foreground | oklch(0.175 0.02 242) blue-tinted | #0A0A0A | oklch(0.145 0 0) |
| --card | oklch(1 0 0) | #FFFFFF | oklch(1 0 0) ✓ same |
| --card-foreground | oklch(0.175 0.02 242) | #0A0A0A | oklch(0.145 0 0) |
| --popover | oklch(1 0 0) | #FFFFFF | oklch(1 0 0) ✓ same |
| --popover-foreground | oklch(0.175 0.02 242) | #0A0A0A | oklch(0.145 0 0) |
| --primary | oklch(0.445 0.059 241.9) | #3D5A80 | oklch(0.462 0.071 255.6) |
| --primary-foreground | oklch(0.985 0 0) | #FFFFFF | oklch(1 0 0) |
| --secondary | oklch(0.945 0.015 241) | #F5F5F5 | oklch(0.970 0 0) |
| --secondary-foreground | oklch(0.35 0.04 242) | #0A0A0A | oklch(0.145 0 0) |
| --muted | oklch(0.955 0.008 112) warm | #F5F5F5 | oklch(0.970 0 0) |
| --muted-foreground | oklch(0.5 0.02 242) | #6B6B6B | oklch(0.528 0 0) |
| --accent | oklch(0.93 0.025 241) blue tint | #E8EDF4 | oklch(0.944 0.011 256.7) |
| --accent-foreground | oklch(0.35 0.04 242) | #1B2E4A | oklch(0.300 0.057 258.0) |
| --border | oklch(0.905 0.015 241) blue-tinted | #E5E5E5 | oklch(0.922 0 0) |
| --input | oklch(0.905 0.015 241) | #E5E5E5 | oklch(0.922 0 0) |
| --destructive | oklch(0.577 0.245 27.325) | #EF4444 | oklch(0.637 0.208 25.3) |
| --ring | oklch(0.717 0.074 241.5) | #3D5A80 | oklch(0.462 0.071 255.6) |

**Key change:** Current palette has warm/yellow tints and blue tints throughout. Design uses neutral grays (#F5F5F5, #EBEBEB, #E5E5E5) + clean navy primary (#3D5A80). The renewal removes the warm hue from backgrounds and the blue tint from borders/muted colors.

Add new custom properties for design tokens not in shadcn defaults:
```css
:root {
  --bg-tertiary: oklch(0.940 0 0);           /* #EBEBEB */
  --text-tertiary: oklch(0.741 0 0);         /* #ABABAB */
  --border-strong: oklch(0.858 0 0);         /* #D0D0D0 */
  --accent-muted: oklch(0.708 0.046 248.5);  /* #8BA4BD */
  --success: oklch(0.723 0.192 149.6);       /* #22C55E */
  --warning: oklch(0.769 0.165 70.1);        /* #F59E0B */
}
```

### 1.2 Tailwind Theme Update
**File: `apps/web/src/app/globals.css` (@theme inline)**

Add the new tokens to the Tailwind theme:
```
--color-bg-tertiary: var(--bg-tertiary);
--color-text-tertiary: var(--text-tertiary);
--color-border-strong: var(--border-strong);
--color-success: var(--success);
--color-warning: var(--warning);
```

### 1.3 Style Constants Update
**File: `apps/web/src/lib/styles.ts`**

Review and update:
- Verify spacing values align with design (20px page padding, 16px list gaps, etc.)
- Update any hardcoded Tailwind classes that reference old color values
- Add new constants if design introduces new patterns

---

## Phase 2: Component Styling Updates (Light Mode)

Update shadcn components + domain components to match the 23 design components.

### 2.1 Shadcn/Shared Components
Files under `apps/web/src/components/ui/`:

| Component | Design Match | Changes |
|-----------|-------------|---------|
| `button.tsx` | Button/Primary, Secondary, Ghost, Destructive, Icon, IconOutline | Verify radius=8, font size/weight, padding |
| `input.tsx` | Input/Text | radius=8, height, border color |
| `badge.tsx` | Badge/Accent, Success, Muted | radius=4, font 12/500 |
| `tabs.tsx` | Tab/Active, Tab/Inactive | Match design tab styles (default + line variants) |
| `card.tsx` | Card/Word, Card/Wordbook | radius=12, border, padding |

### 2.2 Layout Components
| Component | Changes |
|-----------|---------|
| `header.tsx` | Match design: 18/600 title, padding 0 20px, 56px height, actions alignment |
| `bottom-nav.tsx` | Match BottomNav component: 5 tabs, active indicator, icon sizes |
| `list-toolbar.tsx` | Match search bar + filter buttons layout from Words List screen |

### 2.3 Domain Components
| Component | Design Screen Reference |
|-----------|------------------------|
| `word-card.tsx` | Word cards in Words List (radius 12, padding 16, border #F5F5F5) |
| `swipeable-word-card.tsx` | Same card style + swipe behavior |
| `wordbook-card.tsx` | Card from Wordbooks screen |
| `flashcard.tsx` | Quiz screen card area |
| `word-form.tsx` | Word Create screen inputs |
| `session-report.tsx` | Quiz completion screen |

---

## Phase 3: Page-by-Page — Light Mode Screens

Implement in this order (matching .pen screen rows):

### Row 1 — Core Pages (904N9)
| Screen | Page File | Node ID |
|--------|-----------|---------|
| Words List | `words/page.tsx` | S8JUy |
| Word Detail | `words/[id]/page.tsx` | 02yEL |
| Wordbooks | `wordbooks/page.tsx` | ILhoC |
| Quiz | `quiz/page.tsx` | aHgD6 |
| Settings | `settings/page.tsx` | wrcQA |
| Settings Scrolled | (same as above, scrolled state) | Q0QDD |
| Landing | Landing page (consent gate or root) | auAqI |

### Row 3 — Secondary Pages (lfoQl)
| Screen | Page File | Node ID |
|--------|-----------|---------|
| Word Create | `words/create/page.tsx` | Hn5Q9 |
| Quiz Revealed | `quiz/page.tsx` (revealed state) | AmOor |
| Mastered | `mastered/page.tsx` | BKLBM |
| Word Scan | `words/scan/page.tsx` | cDLxF |
| Wordbook Create | `wordbooks/create/page.tsx` | S66pE |

### Row 5 — Auth Pages (FbrUw) — Light only
| Screen | Page File | Node ID |
|--------|-----------|---------|
| Login | Auth login page | mJQkY |
| Sign Up | Auth signup page | vj0xr |

### Row 6 — Sub Pages (jiRrR)
| Screen | Page File | Node ID |
|--------|-----------|---------|
| Browse Wordbooks | `wordbooks/browse/page.tsx` | 4gK1Z |
| Import Dialog | Import wordbook dialog | zFYfK |
| Scan Preview | `words/scan/page.tsx` (preview state) | JMdMN |
| Scan Edit | `words/scan/page.tsx` (edit state) | BIEwB |

### Row 7 — Settings Sub (XjTLt)
| Screen | Page File | Node ID |
|--------|-----------|---------|
| Quiz Settings | `settings/quiz/page.tsx` | Y87vY |
| Quiz Stats | `settings/quiz-stats/page.tsx` | s45hG |
| Achievements | `settings/achievements/page.tsx` | W2Voz |
| Licenses | `settings/licenses/page.tsx` | MpJsr |

### Row 8 — Auth & Settings Sub (RcAEV)
| Screen | Page File | Node ID |
|--------|-----------|---------|
| Consent Gate | Consent gate component | Scivm |
| Settings Profile | `settings/profile/page.tsx` | EBWBL |
| OCR Settings | `settings/ocr/page.tsx` | HEDQe |

---

## Phase 4: Dark Mode

After all light mode pages are complete:

### 4.1 Dark CSS Variables
Update `.dark` block in globals.css (computed OKLCH from design hex):

| CSS Variable | Target Hex | OKLCH |
|---|---|---|
| --background | #0A0A0A | oklch(0.145 0 0) |
| --foreground | #F5F5F5 | oklch(0.970 0 0) |
| --card | #141414 | oklch(0.191 0 0) |
| --card-foreground | #F5F5F5 | oklch(0.970 0 0) |
| --primary | #3D5A80 | oklch(0.462 0.071 255.6) |
| --primary-foreground | #FFFFFF | oklch(1 0 0) |
| --secondary | #1E1E1E | oklch(0.235 0 0) |
| --muted | #1E1E1E | oklch(0.235 0 0) |
| --muted-foreground | #999999 | oklch(0.683 0 0) |
| --accent | #1B2E4A | oklch(0.300 0.057 258.0) |
| --accent-foreground | #F5F5F5 | oklch(0.970 0 0) |
| --border | #2A2A2A | oklch(0.285 0 0) |
| --destructive | #F87171 | oklch(0.711 0.166 22.2) |
| --ring | #3D5A80 | oklch(0.462 0.071 255.6) |

Dark-only additional tokens:
```css
.dark {
  --bg-tertiary: oklch(0.235 0 0);           /* #1E1E1E */
  --bg-elevated: oklch(0.218 0 0);           /* #1A1A1A */
  --text-tertiary: oklch(0.510 0 0);         /* #666666 */
  --border-strong: oklch(0.409 0 0);         /* #4A4A4A */
  --accent-muted: oklch(0.708 0.046 248.5);  /* #8BA4BD — same light/dark */
}
```

### 4.2 Dark Mode Page Verification
Verify each dark screen matches its .pen counterpart:
- Row 2 (2aSx5): Dark versions of core pages
- Row 4 (SG2q3): Dark secondary pages
- Row 6 dark (vTnN9): Dark sub pages
- Row 7 dark (c6v5Y): Dark settings sub
- Row 8 dark (s65mz): Dark auth & settings sub

---

## Phase 5: i18n Verification

- Default locale is already `ko` ✓
- .pen text is in English → maps to existing i18n keys
- Verify no hardcoded English strings were introduced during renewal
- Ensure all new UI elements use `t.scope.key` pattern

---

## Implementation Strategy

- **Team agents**: Use parallel agents per phase for speed
  - Phase 1: Single agent (CSS changes are sequential)
  - Phase 2: 2-3 agents (components can be updated in parallel)
  - Phase 3: 3-4 agents (page groups can be done in parallel)
  - Phase 4: 1-2 agents (mostly variable changes + verification)
- **Verification**: After each phase, visual comparison with .pen screenshots
- **No breaking changes**: Each phase should produce a working state

---

## Files to Modify

### Foundation (Phase 1-2)
- `apps/web/src/app/globals.css` — CSS variables, theme
- `apps/web/src/lib/styles.ts` — style constants
- `apps/web/src/components/ui/button.tsx` — button variants
- `apps/web/src/components/ui/input.tsx` — input styles
- `apps/web/src/components/ui/badge.tsx` — badge variants
- `apps/web/src/components/ui/tabs.tsx` — tab styles
- `apps/web/src/components/ui/card.tsx` — card styles
- `apps/web/src/components/layout/header.tsx` — header layout
- `apps/web/src/components/layout/bottom-nav.tsx` — bottom nav
- `apps/web/src/components/layout/list-toolbar.tsx` — search/filter toolbar

### Pages (Phase 3) — 22 page files + domain components
- All `page.tsx` files under `apps/web/src/app/(app)/`
- `apps/web/src/components/word/word-card.tsx`
- `apps/web/src/components/word/swipeable-word-card.tsx`
- `apps/web/src/components/word/word-form.tsx`
- `apps/web/src/components/wordbook/wordbook-card.tsx`
- `apps/web/src/components/quiz/flashcard.tsx`
- `apps/web/src/components/quiz/session-report.tsx`
- `apps/web/src/components/scan/*`

---

## Verification

After each phase:
1. `bun run build` — no TypeScript errors
2. Visual comparison: run dev server, compare each page against .pen screenshots
3. Check both locales (ko/en) render correctly
4. Verify dark/light mode toggle works
