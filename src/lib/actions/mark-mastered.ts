import { invalidateListCache } from '@/lib/list-cache';
import { requestDueCountRefresh } from '@/lib/quiz/due-count-sync';
import type { DataRepository } from '@/lib/repository/types';

/**
 * Mark a word as mastered + invalidate all related list caches.
 * Each caller still handles its own local state update separately.
 */
export async function markWordMastered(
  repo: DataRepository,
  wordId: string,
): Promise<void> {
  await repo.words.setMastered(wordId, true);
  invalidateListCache('words');
  invalidateListCache('mastered');
  invalidateListCache('wordbooks');
  requestDueCountRefresh();
}
