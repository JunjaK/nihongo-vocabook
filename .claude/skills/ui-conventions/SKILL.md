---
name: ui-conventions
description: |
  UI conventions for Nihongo VocaBook. Read when working with header actions, buttons,
  icons, animations, i18n translations, toast notifications, or any user-facing UI
  component styling and behavior.
---

# UI Conventions

## Header Actions Convention

Header actions MUST be icon-only buttons (`variant="ghost" size="icon-sm"` + `aria-label`). No text buttons in the header actions area.

| Page type | Header action (icons) | Bottom button |
|-----------|----------------------|---------------|
| Words list | Scan icon → `/words/scan` | Add Word → `/words/new` |
| Wordbooks list | Download icon → `/wordbooks/browse` | Create Wordbook → `/wordbooks/new` |
| Wordbook detail (owned) | Edit (Pencil) | Add Words (outline) + Start Quiz (primary) |
| Wordbook detail (subscribed) | Unsubscribe (Link2Off) | Start Quiz |
| Wordbook edit | Delete (Trash2) + Cancel (X) | Save (form submit) |
| Word detail | Edit, Delete | — |

## Button UI/UX

- **All buttons MUST have a visible background or border** — text-only buttons (no bg, no border) are forbidden. Users cannot recognize plain text as interactive.
- Allowed variants: `default` (bg), `outline` (border), `secondary` (bg), `destructive` (bg), `ghost` (only for icon buttons where the icon shape provides affordance)
- **Never use `link` or text-only style for action buttons**
- Right-aligned, rightmost = primary
- Order (L→R): secondary > info > warning > primary
- Destructive actions: visually separated

| Context | Style |
|---------|-------|
| Page header | Icon-only ghost (`variant="ghost" size="icon-sm"`) |
| Tab/section | Outline or icon+text |
| Toolbar | Icon-only ghost + tooltip |
| List row | Ghost (icon) / outline |
| Modal footer | Cancel (outline) > Confirm (default) |
| Bottom bar (multi) | `flex gap-2` with `flex-1` each — **always horizontal, never vertical** |
| Bottom bar (single) | `w-full` |

---

## Checkbox / Toggle Row Pattern

Selectable list rows (e.g., word preview) MUST use `<div>` with ARIA attributes. Never use bare `<label>` without an associated `<input>`.

```tsx
<div
  role="checkbox"
  aria-checked={isChecked}
  tabIndex={0}
  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
    isChecked ? 'border-primary/20 bg-primary/[0.03]' : 'border-transparent opacity-60'
  }`}
  onClick={() => toggle(i)}
  onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(i); } }}
>
  {/* Checkbox indicator — rounded-lg (~8px) */}
  <div className={`flex size-5 shrink-0 items-center justify-center rounded-lg border transition-colors ${
    isChecked ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30'
  }`}>
    {isChecked && <Check className="size-3.5" strokeWidth={3} />}
  </div>
  {/* Content */}
  <div className="min-w-0 flex-1">...</div>
</div>
```

**Rules:**
- Whole row is clickable (not just the checkbox indicator)
- Keyboard accessible: Space and Enter toggle
- Checkbox border radius: `rounded-lg` (~8px)
- Use `role="checkbox"` + `aria-checked` for screen readers

---

## Icons

Use project icon exports from `@/components/ui/icons` (Tabler-based compatibility layer) for all icons.

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

**Available animation classes:** `animate-fade-in`, `animate-slide-up`, `animate-slide-down-fade`, `animate-stagger`, `animate-page`, `animate-scale-in`

---

## i18n Conventions

- Access: `const { t } = useTranslation();` → `t.scope.key`
- Types: `/src/lib/i18n/types.ts` — `Translations` interface
- Files: `en.ts`, `ko.ts` implementing `Translations`
- Key format: `scope.camelCaseKey` (e.g. `t.words.searchPlaceholder`)
- Parametric: `(n: number) => string` for plurals/interpolation
- Korean quoted text: corner brackets `「」` (U+300C, U+300D)
- ALL user-facing strings must go through i18n — no hardcoded text
- When adding/changing strings, update all three files together: `types.ts`, `en.ts`, `ko.ts`

---

## Toast Notifications

Use `sonner` for all user feedback:

```tsx
import { toast } from 'sonner';

toast.success(t.words.wordAdded);     // success
toast.error(t.settings.importError);  // error
toast.info(t.settings.noLocalData);   // info
```
