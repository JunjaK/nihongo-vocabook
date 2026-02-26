const DUE_COUNT_REFRESH_EVENT = 'quiz:due-count-refresh';

export function requestDueCountRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DUE_COUNT_REFRESH_EVENT));
}

export function getDueCountRefreshEventName(): string {
  return DUE_COUNT_REFRESH_EVENT;
}
