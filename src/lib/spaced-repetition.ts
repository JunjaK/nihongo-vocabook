import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
  type Card,
  type Grade,
} from 'ts-fsrs';
import type { StudyProgress } from '@/types/word';

const params = generatorParameters();
const f = fsrs(params);

/**
 * Convert StudyProgress to ts-fsrs Card.
 */
export function progressToCard(progress: StudyProgress): Card {
  const card = createEmptyCard(progress.lastReviewedAt ?? new Date());
  return {
    ...card,
    due: progress.nextReview,
    stability: progress.stability,
    difficulty: progress.difficulty,
    elapsed_days: progress.elapsedDays,
    scheduled_days: progress.scheduledDays,
    reps: progress.reviewCount,
    lapses: progress.lapses,
    state: progress.cardState as State,
    last_review: progress.lastReviewedAt ?? undefined,
  };
}

/**
 * Convert ts-fsrs Card fields back to StudyProgress partial fields.
 */
export function cardToProgress(card: Card): Pick<
  StudyProgress,
  'nextReview' | 'intervalDays' | 'easeFactor' | 'reviewCount' | 'lastReviewedAt' |
  'stability' | 'difficulty' | 'elapsedDays' | 'scheduledDays' | 'learningSteps' | 'lapses' | 'cardState'
> {
  return {
    nextReview: card.due instanceof Date ? card.due : new Date(card.due),
    intervalDays: card.scheduled_days,
    easeFactor: 2.5, // kept for backward compat, not used by FSRS
    reviewCount: card.reps,
    lastReviewedAt: card.last_review ? (card.last_review instanceof Date ? card.last_review : new Date(card.last_review)) : null,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: 0,
    lapses: card.lapses,
    cardState: card.state as number,
  };
}

/**
 * Map quality (0-5) to ts-fsrs Rating.
 * 0 = Again, 3 = Hard, 4 = Good, 5 = Easy
 */
export function mapQualityToRating(quality: number): Grade {
  switch (quality) {
    case 0: return Rating.Again;
    case 3: return Rating.Hard;
    case 4: return Rating.Good;
    case 5: return Rating.Easy;
    default: return quality <= 2 ? Rating.Again : Rating.Good;
  }
}

/**
 * Review a card with FSRS algorithm.
 * @param quality 0=Again, 3=Hard, 4=Good, 5=Easy
 * @param progress current study progress
 * @param wordId the word ID
 * @returns updated study progress
 */
export function reviewCard(quality: number, progress: StudyProgress): StudyProgress {
  const card = progressToCard(progress);
  const rating = mapQualityToRating(quality);
  const now = new Date();
  const result = f.next(card, now, rating);
  const updated = cardToProgress(result.card);

  return {
    ...progress,
    ...updated,
  };
}

/**
 * Create initial study progress for a new word.
 */
export function createInitialProgress(wordId: string): StudyProgress {
  return {
    id: crypto.randomUUID(),
    wordId,
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
    cardState: 0, // New
  };
}

/**
 * Check if a card is new (never reviewed).
 */
export function isNewCard(progress: StudyProgress | null): boolean {
  if (!progress) return true;
  return progress.cardState === 0 && progress.reviewCount === 0;
}

export type IntervalFormatter = {
  lessThanMinute: string;
  minutes: (n: number) => string;
  hours: (n: number) => string;
  days: (n: number) => string;
  months: (n: number) => string;
};

/**
 * Get preview of next interval for all 4 ratings.
 * Uses the provided formatter for localized, human-readable labels.
 */
export function getReviewPreview(
  progress: StudyProgress | null,
  fmt: IntervalFormatter,
): {
  again: string;
  hard: string;
  good: string;
  easy: string;
} {
  const card = progress
    ? progressToCard(progress)
    : createEmptyCard(new Date());
  const now = new Date();

  const formatInterval = (nextCard: Card): string => {
    const diffMs = (nextCard.due instanceof Date ? nextCard.due.getTime() : new Date(nextCard.due).getTime()) - now.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return fmt.lessThanMinute;
    if (diffMin < 60) return fmt.minutes(diffMin);
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return fmt.hours(diffHours);
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 30) return fmt.days(diffDays);
    const diffMonths = Math.round(diffDays / 30);
    return fmt.months(diffMonths);
  };

  return {
    again: formatInterval(f.next(card, now, Rating.Again).card),
    hard: formatInterval(f.next(card, now, Rating.Hard).card),
    good: formatInterval(f.next(card, now, Rating.Good).card),
    easy: formatInterval(f.next(card, now, Rating.Easy).card),
  };
}
