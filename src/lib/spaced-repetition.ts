import type { StudyProgress } from '@/types/word';

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * SM-2 spaced repetition algorithm.
 * @param quality 0-5 (0=forgot completely, 5=perfect recall)
 * @param progress current study progress
 * @returns updated study progress
 */
export function sm2(quality: number, progress: StudyProgress): StudyProgress {
  let { easeFactor, intervalDays, reviewCount } = progress;

  if (quality >= 3) {
    if (reviewCount === 0) intervalDays = 1;
    else if (reviewCount === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);
    reviewCount++;
  } else {
    reviewCount = 0;
    intervalDays = 1;
  }

  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  return {
    ...progress,
    easeFactor,
    intervalDays,
    reviewCount,
    nextReview: addDays(new Date(), intervalDays),
    lastReviewedAt: new Date(),
  };
}

export function createInitialProgress(wordId: string): StudyProgress {
  return {
    id: crypto.randomUUID(),
    wordId,
    nextReview: new Date(),
    intervalDays: 0,
    easeFactor: 2.5,
    reviewCount: 0,
    lastReviewedAt: null,
  };
}
