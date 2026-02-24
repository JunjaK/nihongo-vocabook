import type { Translations } from '@/lib/i18n/types';

/** Default page size for paginated word lists. */
export const PAGE_SIZE = 100;

export function getWordSortOptions(t: Translations) {
  return [
    { value: 'priority', label: t.priority.sortByPriority },
    { value: 'newest', label: t.priority.sortByNewest },
    { value: 'alphabetical', label: t.priority.sortByAlphabetical },
  ];
}
