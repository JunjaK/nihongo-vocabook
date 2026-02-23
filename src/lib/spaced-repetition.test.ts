import { describe, it, expect } from 'vitest';
import {
  reviewCard,
  createInitialProgress,
  isNewCard,
  getReviewPreview,
  mapQualityToRating,
  progressToCard,
  cardToProgress,
} from './spaced-repetition';
import { Rating } from 'ts-fsrs';
import type { StudyProgress } from '@/types/word';

function makeProgress(overrides?: Partial<StudyProgress>): StudyProgress {
  return {
    id: 'test-id',
    wordId: 'word-1',
    nextReview: new Date(),
    intervalDays: 0,
    easeFactor: 2.5,
    reviewCount: 0,
    lastReviewedAt: null,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    lapses: 0,
    cardState: 0,
    ...overrides,
  };
}

describe('createInitialProgress', () => {
  it('creates progress with New card state', () => {
    const progress = createInitialProgress('word-123');
    expect(progress.wordId).toBe('word-123');
    expect(progress.cardState).toBe(0);
    expect(progress.reviewCount).toBe(0);
    expect(progress.stability).toBe(0);
    expect(progress.difficulty).toBe(0);
    expect(progress.lastReviewedAt).toBeNull();
    expect(progress.id).toBeTruthy();
  });
});

describe('isNewCard', () => {
  it('returns true for null progress', () => {
    expect(isNewCard(null)).toBe(true);
  });

  it('returns true for brand new progress', () => {
    const progress = createInitialProgress('w1');
    expect(isNewCard(progress)).toBe(true);
  });

  it('returns false for reviewed progress', () => {
    const progress = makeProgress({ reviewCount: 3, cardState: 2 });
    expect(isNewCard(progress)).toBe(false);
  });
});

describe('mapQualityToRating', () => {
  it('maps 0 to Again', () => {
    expect(mapQualityToRating(0)).toBe(Rating.Again);
  });

  it('maps 3 to Hard', () => {
    expect(mapQualityToRating(3)).toBe(Rating.Hard);
  });

  it('maps 4 to Good', () => {
    expect(mapQualityToRating(4)).toBe(Rating.Good);
  });

  it('maps 5 to Easy', () => {
    expect(mapQualityToRating(5)).toBe(Rating.Easy);
  });

  it('maps 1 and 2 to Again', () => {
    expect(mapQualityToRating(1)).toBe(Rating.Again);
    expect(mapQualityToRating(2)).toBe(Rating.Again);
  });
});

describe('reviewCard', () => {
  it('advances a new card after Good rating', () => {
    const initial = createInitialProgress('w1');
    const updated = reviewCard(4, initial);

    expect(updated.reviewCount).toBeGreaterThan(0);
    expect(updated.lastReviewedAt).toBeInstanceOf(Date);
    expect(updated.nextReview.getTime()).toBeGreaterThan(Date.now() - 1000);
    expect(updated.wordId).toBe('w1');
  });

  it('produces different intervals for different ratings', () => {
    const initial = createInitialProgress('w1');

    const again = reviewCard(0, initial);
    const hard = reviewCard(3, initial);
    const good = reviewCard(4, initial);
    const easy = reviewCard(5, initial);

    // Easy should schedule furthest out, Again should be closest
    expect(easy.nextReview.getTime()).toBeGreaterThanOrEqual(good.nextReview.getTime());
    expect(good.nextReview.getTime()).toBeGreaterThanOrEqual(hard.nextReview.getTime());
    expect(hard.nextReview.getTime()).toBeGreaterThanOrEqual(again.nextReview.getTime());
  });

  it('preserves id and wordId', () => {
    const initial = makeProgress({ id: 'keep-me', wordId: 'w99' });
    const updated = reviewCard(4, initial);
    expect(updated.id).toBe('keep-me');
    expect(updated.wordId).toBe('w99');
  });

  it('increases stability after Good review of a reviewed card', () => {
    const initial = createInitialProgress('w1');
    const firstReview = reviewCard(4, initial);
    // Simulate time passing
    const withElapsedTime = {
      ...firstReview,
      nextReview: new Date(Date.now() - 86400000), // 1 day ago
    };
    const secondReview = reviewCard(4, withElapsedTime);
    expect(secondReview.stability).toBeGreaterThan(0);
  });

  it('increments lapses on Again for reviewed card', () => {
    const reviewed = makeProgress({
      reviewCount: 5,
      cardState: 2,
      stability: 10,
      difficulty: 5,
      scheduledDays: 10,
      elapsedDays: 10,
      lastReviewedAt: new Date(Date.now() - 86400000 * 10),
    });
    const afterAgain = reviewCard(0, reviewed);
    expect(afterAgain.lapses).toBeGreaterThanOrEqual(1);
  });
});

describe('progressToCard / cardToProgress roundtrip', () => {
  it('preserves key fields through conversion', () => {
    const progress = makeProgress({
      stability: 5.5,
      difficulty: 3.2,
      elapsedDays: 7,
      scheduledDays: 14,
      reviewCount: 10,
      lapses: 2,
      cardState: 2,
      lastReviewedAt: new Date('2025-01-01'),
    });

    const card = progressToCard(progress);
    const back = cardToProgress(card);

    expect(back.stability).toBeCloseTo(5.5);
    expect(back.difficulty).toBeCloseTo(3.2);
    expect(back.elapsedDays).toBe(7);
    expect(back.scheduledDays).toBe(14);
    expect(back.reviewCount).toBe(10);
    expect(back.lapses).toBe(2);
    expect(back.cardState).toBe(2);
  });
});

describe('getReviewPreview', () => {
  it('returns all 4 interval strings for null progress', () => {
    const preview = getReviewPreview(null);
    expect(preview).toHaveProperty('again');
    expect(preview).toHaveProperty('hard');
    expect(preview).toHaveProperty('good');
    expect(preview).toHaveProperty('easy');
    // All should be non-empty strings
    expect(preview.again.length).toBeGreaterThan(0);
    expect(preview.hard.length).toBeGreaterThan(0);
    expect(preview.good.length).toBeGreaterThan(0);
    expect(preview.easy.length).toBeGreaterThan(0);
  });

  it('returns all 4 interval strings for existing progress', () => {
    const progress = makeProgress({
      stability: 10,
      difficulty: 5,
      cardState: 2,
      reviewCount: 5,
      scheduledDays: 10,
      elapsedDays: 10,
      lastReviewedAt: new Date(Date.now() - 86400000 * 10),
    });
    const preview = getReviewPreview(progress);
    expect(typeof preview.again).toBe('string');
    expect(typeof preview.hard).toBe('string');
    expect(typeof preview.good).toBe('string');
    expect(typeof preview.easy).toBe('string');
  });

  it('formats intervals with proper units', () => {
    const preview = getReviewPreview(null);
    // Each should end with m, h, d, or mo
    const validPattern = /^(<1m|\d+(m|h|d|mo))$/;
    expect(preview.again).toMatch(validPattern);
    expect(preview.hard).toMatch(validPattern);
    expect(preview.good).toMatch(validPattern);
    expect(preview.easy).toMatch(validPattern);
  });
});
