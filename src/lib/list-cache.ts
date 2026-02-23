interface CacheEntry<T> {
  data: T;
  timestamp: number;
  scrollOffset: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const TTL = 5 * 60 * 1000; // 5 minutes

export function getListCache<T>(key: string): { data: T; scrollOffset: number } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL) {
    cache.delete(key);
    return null;
  }
  return { data: entry.data as T, scrollOffset: entry.scrollOffset };
}

export function setListCache<T>(key: string, data: T, scrollOffset = 0): void {
  cache.set(key, { data, timestamp: Date.now(), scrollOffset });
}

export function invalidateListCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}
