# Nihongo VocaBook — Project Instructions

## Bottom Fixed Button Pattern

All primary action buttons at the bottom of a page/step MUST use the bottom fixed pattern. This keeps the button always visible regardless of scroll position.

**Required structure:**

```tsx
{/* Parent must be flex column with min-h-0 flex-1 */}
<div className="flex min-h-0 flex-1 flex-col">
  {/* Scrollable content area */}
  <div className="flex-1 overflow-y-auto p-4">
    {/* ... content ... */}
  </div>

  {/* Fixed bottom button — OUTSIDE the scrollable area */}
  <div className="shrink-0 bg-background px-4 pb-3">
    <div className="mb-3 h-px bg-border" />
    <Button className="w-full" ...>Action</Button>
  </div>
</div>
```

**Rules:**
- The button container uses `shrink-0 bg-background px-4 pb-3`
- A separator `<div className="mb-3 h-px bg-border" />` sits above the button
- The button container is a **sibling** of the scrollable content, never nested inside it
- The parent container must be `flex min-h-0 flex-1 flex-col` so the scroll area fills remaining space
- Applies to: forms, wizard steps, detail pages with action buttons, confirmation dialogs
