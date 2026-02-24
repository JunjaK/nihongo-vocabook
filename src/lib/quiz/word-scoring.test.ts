import { describe, it, expect } from 'vitest';
import {
  priorityWeight,
  jlptWeight,
  overdueFactor,
  calcQuizScore,
  selectDueWords,
} from './word-scoring';
import type { WordWithProgress } from '@/types/word';
import type { StudyProgress } from '@/types/word';

function makeWord(overrides: Partial<WordWithProgress> = {}): WordWithProgress {
  return {
    id: 'w1',
    term: '食べる',
    reading: 'たべる',
    meaning: 'to eat',
    notes: null,
    tags: [],
    jlptLevel: 3,
    priority: 2,
    mastered: false,
    masteredAt: null,
    isLeech: false,
    leechAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    progress: null,
    ...overrides,
  };
}

function makeProgressObj(overrides: Partial<StudyProgress> = {}): StudyProgress {
  return {
    id: 'p1',
    wordId: 'w1',
    nextReview: new Date(),
    intervalDays: 1,
    easeFactor: 2.5,
    reviewCount: 1,
    lastReviewedAt: new Date(),
    stability: 1,
    difficulty: 5,
    elapsedDays: 1,
    scheduledDays: 1,
    learningSteps: 0,
    lapses: 0,
    cardState: 2,
    ...overrides,
  };
}

describe('priorityWeight', () => {
  it('returns 1.0 for high priority', () => {
    expect(priorityWeight(1)).toBe(1.0);
  });

  it('returns 0.7 for medium priority', () => {
    expect(priorityWeight(2)).toBe(0.7);
  });

  it('returns 0.4 for low priority', () => {
    expect(priorityWeight(3)).toBe(0.4);
  });

  it('defaults to 0.7 for unknown priority', () => {
    expect(priorityWeight(99)).toBe(0.7);
  });
});

describe('jlptWeight', () => {
  it('returns 0.7 when user JLPT is null', () => {
    expect(jlptWeight(null, 3)).toBe(0.7);
  });

  it('returns 0.7 when word JLPT is null', () => {
    expect(jlptWeight(3, null)).toBe(0.7);
  });

  it('returns 1.0 for exact match', () => {
    expect(jlptWeight(3, 3)).toBe(1.0);
  });

  it('returns 0.9 when word is one level harder', () => {
    expect(jlptWeight(3, 4)).toBe(0.9);
  });

  it('returns 0.8 when word is one level easier', () => {
    expect(jlptWeight(3, 2)).toBe(0.8);
  });

  it('returns 0.6 when word is much harder', () => {
    expect(jlptWeight(3, 5)).toBe(0.6);
  });

  it('returns 0.5 when word is much easier', () => {
    expect(jlptWeight(3, 1)).toBe(0.5);
  });
});

describe('overdueFactor', () => {
  it('returns 0.5 for new word (null progress)', () => {
    expect(overdueFactor(null)).toBe(0.5);
  });

  it('returns 0.8 for word not yet due', () => {
    const progress = makeProgressObj({
      nextReview: new Date(Date.now() + 86400000), // tomorrow
    });
    expect(overdueFactor(progress)).toBe(0.8);
  });

  it('returns 1.0 for word due within 3 days', () => {
    const progress = makeProgressObj({
      nextReview: new Date(Date.now() - 86400000), // 1 day ago
    });
    expect(overdueFactor(progress)).toBe(1.0);
  });

  it('returns 1.2 for word overdue 3-7 days', () => {
    const progress = makeProgressObj({
      nextReview: new Date(Date.now() - 5 * 86400000), // 5 days ago
    });
    expect(overdueFactor(progress)).toBe(1.2);
  });

  it('returns 1.5 for word overdue > 7 days', () => {
    const progress = makeProgressObj({
      nextReview: new Date(Date.now() - 10 * 86400000), // 10 days ago
    });
    expect(overdueFactor(progress)).toBe(1.5);
  });
});

describe('calcQuizScore', () => {
  it('gives higher score to high priority overdue words', () => {
    const highPriorityOverdue = makeWord({
      id: 'w1',
      priority: 1,
      progress: makeProgressObj({
        nextReview: new Date(Date.now() - 10 * 86400000),
      }),
    });
    const lowPriorityNotDue = makeWord({
      id: 'w2',
      priority: 3,
      progress: makeProgressObj({
        nextReview: new Date(Date.now() + 86400000),
      }),
    });

    const score1 = calcQuizScore(highPriorityOverdue, null);
    const score2 = calcQuizScore(lowPriorityNotDue, null);
    expect(score1).toBeGreaterThan(score2);
  });

  it('returns a positive number', () => {
    const word = makeWord();
    expect(calcQuizScore(word, null)).toBeGreaterThan(0);
  });
});

describe('selectDueWords', () => {
  it('returns at most `limit` words', () => {
    const words = Array.from({ length: 10 }, (_, i) =>
      makeWord({ id: `w${i}` }),
    );
    const result = selectDueWords(words, 3, null);
    expect(result).toHaveLength(3);
  });

  it('returns all words if fewer than limit', () => {
    const words = [makeWord({ id: 'w1' }), makeWord({ id: 'w2' })];
    const result = selectDueWords(words, 10, null);
    expect(result).toHaveLength(2);
  });

  it('sorts by score descending — high priority first', () => {
    const low = makeWord({ id: 'low', priority: 3 });
    const high = makeWord({ id: 'high', priority: 1 });
    const result = selectDueWords([low, high], 10, null);
    expect(result[0].id).toBe('high');
    expect(result[1].id).toBe('low');
  });

  it('handles empty array', () => {
    expect(selectDueWords([], 5, null)).toEqual([]);
  });
});
