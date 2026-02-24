import type { Translations } from '@/lib/i18n/types';

export function getWordSortOptions(t: Translations) {
  return [
    { value: 'priority', label: t.priority.sortByPriority },
    { value: 'newest', label: t.priority.sortByNewest },
    { value: 'alphabetical', label: t.priority.sortByAlphabetical },
  ];
}
