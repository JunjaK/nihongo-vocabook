# UI/UX Design Audit — Nihongo VocaBook

> Audited: 2026-02-22
> Scope: All pages (Landing, Words, Wordbooks, Quiz, Mastered, Settings, Word Form, Login) in both light and dark modes at 390x844 viewport.

## Overall Assessment

The app has a solid functional foundation — clean layout, consistent use of shadcn/ui, and a well-integrated brand color palette (c1-c4 steel blue family). However, from a design perspective, it reads as a **developer prototype** rather than a **designed product**. Every page uses the same flat, sparse layout with minimal visual hierarchy, no motion, and no emotional character.

---

## 1. Typography — Monotonous and Undifferentiated

**Problem**: Geist Sans is used universally — headers, body, nav labels, form labels, buttons. Nothing distinguishes the Japanese kanji/kana (the primary content) from UI chrome.

**Recommendations**:
- Use a **dedicated Japanese-optimized font** (Noto Sans JP, or BIZ UDGothic) for word terms/readings. This is a Japanese vocabulary app — the kanji and kana deserve typographic care.
- Increase the word term size significantly on cards (currently `text-xl` feels small for kanji study). Consider `text-2xl` to `text-3xl` on detail pages.
- Form labels currently use the same weight as everything else. Use lighter weight (`font-normal text-muted-foreground`) for labels and bolder for values.

---

## 2. Landing Page — Generic and Forgettable

**Problem**: Vertically centered text with two buttons and an emoji list. There's zero personality, no visual hook, and no sense that this is a Japanese learning tool.

**Recommendations**:
- Add a hero illustration or stylized kanji background. Even a large decorative kanji character at low opacity would set the mood.
- The feature list (emoji + text) lacks visual weight. Consider cards with subtle backgrounds or a horizontal scroll of feature panels.
- The "Start Learning" and "Sign In" buttons are stacked in a narrow 192px column. They feel timid — make the primary CTA wider (full-width minus padding) and give it more presence.
- Add a subtle gradient or mesh background instead of the flat c4 off-white.

---

## 3. Empty States — Missed Opportunity

**Problem**: Every page shows bare text when empty. The empty state is the **first thing a new user sees** — it should onboard, not bore.

**Recommendations**:
- Add illustrative empty state graphics (simple SVG illustrations — an open book, a stack of cards).
- Make the CTA in empty states a prominent button, not just inline text.
- Quiz "All caught up" has an emoji (good) but the rest of the page is vast whitespace with no visual payoff. Consider a celebratory animation or progress summary.

---

## 4. Bottom Navigation — Crowded at 5 Items

**Problem**: 5 nav items in a mobile bottom bar means each item is small and cramped. The longest label ("Mastered") gets compressed. The icons are thin stroke icons at 20px — they don't have enough visual weight to read clearly at this size.

**Recommendations**:
- Increase nav icons to 24px (`h-6 w-6`) for better tap targets and readability.
- Active state is only a color change (primary blue). Add a filled icon variant or a subtle indicator pill/dot below the active icon.
- The nav bar `h-14` is tight for 5 items with labels. Consider `h-16` for breathing room.
- Alternatively, consider moving Settings to a header gear icon and keep nav to 4 items.

---

## 5. Header — Too Thin and Disconnected

**Problem**: The header is a flat bar (`h-14`) with a title and some action buttons crammed together. On the words page, toggle and add buttons are all jammed next to the title in small outline buttons.

**Recommendations**:
- Separate the action bar from the title. Title on one line, filter/action buttons on a second line below.
- The toggle buttons (Reading/Meaning) are filters — they should look like toggle chips or segmented controls, not generic outline buttons.
- "+ Add" is a primary action mixed with secondary filters. It should be visually differentiated — perhaps a FAB (floating action button) instead.

---

## 6. Search Bar — Visually Heavy, Functionally Awkward

**Problem**: The search input + "Search" button takes up significant horizontal space. The button is redundant with Enter key submission. The bar appears on Words and Mastered pages but not Wordbooks — inconsistent.

**Recommendations**:
- Use an expandable search: tap a search icon to reveal the input. This saves space when not searching.
- Remove the explicit "Search" button — Enter key submission is sufficient (already implemented). The button wastes space.
- Add a clear (X) button inside the input when there's text.

---

## 7. Word Card — Flat and Lacks Information Density

**Problem**: Word cards are simple bordered rectangles with term, reading, and meaning. There's no visual hierarchy beyond font size. Tags, JLPT level, and study progress are invisible on the list view.

**Recommendations**:
- Show JLPT level as a small colored badge (N5=green, N1=red gradient) on the card.
- Show tags as small pills below the meaning.
- Add a subtle left-border color or accent for visual scanning.
- The reveal button (eye icon) is not discoverable — first-time users won't know to tap it. Consider a brief onboarding tooltip or animation.

---

## 8. Word Form — Dense but Disorganized

**Problem**: The add/edit form is a long vertical scroll of inputs with no visual grouping. Dictionary search, core fields, and metadata are all at the same visual level.

**Recommendations**:
- Group related fields with section dividers or card backgrounds:
  - **Search**: Dictionary lookup (visually distinct, perhaps with a different background)
  - **Core**: Term, Reading, Meaning (most important — larger inputs)
  - **Metadata**: JLPT, Tags, Notes (collapsible or secondary section)
- The submit button at the bottom disappears below the fold on smaller screens. Consider a sticky bottom button.

---

## 9. Settings Page — Functional but Boring

**Problem**: Simple label + button list. Every section looks identical. No icons, no visual hierarchy.

**Recommendations**:
- Add icons before section headers (user icon for Account, globe for Language, palette for Theme, etc.)
- The active language/theme button uses `variant="default"` (filled primary) while inactive uses `outline`. This works but the buttons are too small and closely packed. Consider larger pill/chip-style selectors.
- The import/export section should have file-type icons (JSON icon, CSV icon) on the buttons.

---

## 10. Dark Mode — Needs Refinement

**Problem**: Dark mode works but the contrast feels off in places. The background (`oklch 0.16`) is very dark, almost pure black. The border (`oklch 1 0 0 / 10%`) is nearly invisible. Cards and backgrounds are hard to distinguish.

**Recommendations**:
- Slightly lighten the dark background to `oklch(0.18 ...)` for better card/surface distinction.
- Increase border opacity from 10% to 15-18% for visible separation.
- The input background (`oklch 1 0 0 / 15%`) on the dark word form looks washed out. Consider a more defined card surface for input backgrounds.

---

## 11. Motion and Delight — Completely Absent

**Problem**: Zero animations anywhere. Page transitions, card appearances, button interactions, navigation switches — everything is instant and flat.

**Recommendations**:
- Add staggered fade-in for word card lists (simple CSS `animation-delay` on each card).
- Add a scale/shadow micro-interaction on card hover/press.
- Quiz card flip should be animated (transform rotateY).
- Page transitions: a subtle fade or slide for route changes.
- Bottom nav active indicator should animate between items.

---

## 12. Spacing and Layout Rhythm

**Problem**: Content hugs the edges with `p-4` padding on everything. The overall layout feels like a list of `div`s with no compositional rhythm.

**Recommendations**:
- Increase horizontal padding on larger phones (`px-5` or `px-6` at 390px+).
- Add more vertical breathing room between sections (settings page sections are `space-y-2`, too tight for distinct sections — use `space-y-4` between sections, `space-y-2` within).
- The login card is the only element with a visible card boundary — this pattern should extend to other pages for visual grouping.

---

## Priority Ranking (Impact vs Effort)

| # | Issue | Impact | Effort |
|---|-------|--------|--------|
| 1 | Empty states with illustrations + CTA buttons | High | Low |
| 2 | Motion/animations (card list, nav, quiz) | High | Medium |
| 3 | Typography: Japanese font for terms | High | Low |
| 4 | Landing page redesign with visual hook | High | Medium |
| 5 | Header reorganization (split title/actions) | Medium | Low |
| 6 | Bottom nav: larger icons + active indicator | Medium | Low |
| 7 | Dark mode contrast refinement | Medium | Low |
| 8 | Word card information density (JLPT badge, tags) | Medium | Medium |
| 9 | Search bar: expandable pattern | Medium | Medium |
| 10 | Word form field grouping | Low | Medium |
| 11 | Settings icons and visual hierarchy | Low | Low |

---

## Summary

The foundation is solid — clean code, consistent component usage, working brand palette. The gap is between "functional" and "designed." Addressing items 1-6 would transform the perceived quality dramatically without architectural changes.
