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

- Right-aligned, rightmost = primary
- Order (L→R): secondary > info > warning > primary
- Destructive actions: visually separated

| Context | Style |
|---------|-------|
| Page header | Text-only |
| Tab/section | Text or icon+text |
| Toolbar | Icon-only + tooltip |
| List row | Ghost/outline |
| Modal footer | Cancel > Confirm |

---

## Icons

Use **Lucide React** (`lucide-react`) for all icons.

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
