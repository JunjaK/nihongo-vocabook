/**
 * Centralized layout style constants.
 *
 * Use with `cn()` from `@/lib/utils` when overrides are needed:
 *   cn(styles.scrollArea, 'p-4')
 *
 * Import individual constants or the whole namespace:
 *   import { bottomBar, bottomSep } from '@/lib/styles';
 *   import { styles } from '@/lib/styles';
 */

// ─── Layout ──────────────────────────────────────────────
/** Flex column wrapper that fills remaining space. Wrap pages that have a bottom bar. */
export const pageWrapper = 'flex min-h-0 flex-1 flex-col';

/** Scrollable content area that fills remaining height. */
export const scrollArea = 'flex-1 overflow-y-auto';

// ─── Bottom Action Bar ───────────────────────────────────
/** Fixed bottom bar container (outside scroll area). */
export const bottomBar = 'shrink-0 bg-background px-4 pb-3';

/** Separator line inside the bottom bar, placed above buttons. */
export const bottomSep = 'mb-3 h-px bg-border';

// ─── List Rendering ──────────────────────────────────────
/** Standard card list container with uniform spacing. */
export const listContainer = 'space-y-2 px-4 pt-2 pb-4';

/** Vertical gap between list items (no padding). */
export const listGap = 'space-y-2';

// ─── Tabs Area ───────────────────────────────────────────
/** Wrapper around TabsList (shrink-0 with horizontal padding). */
export const tabsBar = 'shrink-0 px-4 pt-2';

/** Horizontal separator below tabs / toolbar. */
export const inlineSep = 'mx-4 h-px bg-border';

/** Search + sort toolbar row. */
export const toolbarRow = 'flex items-center gap-2 px-4 py-2';

// ─── Skeleton Loading ────────────────────────────────────
/** Skeleton list container for word-height items (60px). */
export const skeletonWordList = 'animate-page flex-1 space-y-2 overflow-y-auto px-4 pt-2';

/** Skeleton list container for card-height items (88px). */
export const skeletonCardList = 'animate-page flex-1 space-y-2 overflow-y-auto p-4';

// ─── Empty State ─────────────────────────────────────────
/** Full-height centered empty state wrapper. */
export const emptyState =
  'animate-fade-in flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground';

/** Decorative icon inside empty state. */
export const emptyIcon = 'mb-3 size-10 text-muted-foreground/50';

// ─── Settings Page ───────────────────────────────────────
/** Settings page scroll area with section spacing. */
export const settingsScroll = 'animate-page flex-1 space-y-6 overflow-y-auto p-4';

/** Settings section container. */
export const settingsSection = 'space-y-3';

/** Settings section heading. */
export const settingsHeading = 'text-sm font-semibold text-foreground';

/** Settings navigation link row. */
export const settingsNavLink =
  'flex items-center justify-between rounded-lg border p-3 active:bg-accent/50';

// ─── Namespace export ────────────────────────────────────
export const styles = {
  pageWrapper,
  scrollArea,
  bottomBar,
  bottomSep,
  listContainer,
  listGap,
  tabsBar,
  inlineSep,
  toolbarRow,
  skeletonWordList,
  skeletonCardList,
  emptyState,
  emptyIcon,
  settingsScroll,
  settingsSection,
  settingsHeading,
  settingsNavLink,
} as const;
