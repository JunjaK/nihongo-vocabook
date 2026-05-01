import type { WordWithProgress, Word, WordExample } from '@/types/word';
import type { QuizCard, QuizSettings } from '@/types/quiz';
import { buildExampleCard } from './example-quiz';

/**
 * Partition candidate words by FSRS state, in priority order for today's session.
 *
 * Priority order (highest to lowest):
 *  1. Relearning cards (cardState=3) — recently lapsed, most urgent
 *  2. Overdue review cards (cardState=2, nextReview < now)
 *  3. Due today (cardState=2, nextReview <= todayEnd)
 *  4. Learning cards (cardState=1)
 *  5. New cards (cardState=0 or no progress)
 */
function rankCandidates(words: WordWithProgress[], now: Date): WordWithProgress[] {
  const relearning: WordWithProgress[] = [];
  const overdue: WordWithProgress[] = [];
  const dueToday: WordWithProgress[] = [];
  const learning: WordWithProgress[] = [];
  const newCards: WordWithProgress[] = [];

  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  for (const w of words) {
    const p = w.progress;
    if (!p) {
      newCards.push(w);
      continue;
    }
    if (p.cardState === 3) {
      relearning.push(w);
    } else if (p.cardState === 2) {
      if (p.nextReview < now) overdue.push(w);
      else if (p.nextReview <= endOfDay) dueToday.push(w);
      else newCards.push(w); // scheduled future but we'll ignore unless pool short
    } else if (p.cardState === 1) {
      learning.push(w);
    } else {
      newCards.push(w);
    }
  }

  return [...relearning, ...overdue, ...dueToday, ...learning, ...newCards];
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface BuildSessionOpts {
  settings: QuizSettings;
  candidates: WordWithProgress[]; // non-mastered words with FSRS progress
  examplesByDictId: Map<string, WordExample[]>;
  distractorPool: Word[]; // user's full vocabulary for distractors
  remainingSlots: number; // dailyGoal - todayCompleted
  now?: Date;
}

/**
 * Build today's quiz session cards.
 *
 * - Hard cap at `remainingSlots` (never exceeds daily goal)
 * - Prioritizes FSRS urgency (relearning > overdue > due > learning > new)
 * - For each selected word, rolls a dice against `exampleQuizRatio` to decide
 *   whether to show example card; falls back to word card if conditions unmet
 *   (no example for the word, or fewer than 3 words in distractor pool)
 */
export function buildSessionCards(opts: BuildSessionOpts): QuizCard[] {
  const { settings, candidates, examplesByDictId, distractorPool, remainingSlots } = opts;
  const now = opts.now ?? new Date();

  if (remainingSlots <= 0) return [];

  const ranked = rankCandidates(candidates, now);
  const picked = ranked.slice(0, remainingSlots);

  const cards: QuizCard[] = [];
  for (const word of picked) {
    const rolled = Math.random() * 100 < settings.exampleQuizRatio;
    const examples = examplesByDictId.get(word.dictionaryEntryId) ?? [];
    const canUseExample =
      rolled && examples.length > 0 && distractorPool.length >= 3;

    if (canUseExample) {
      const card = buildExampleCard(word, examples, distractorPool);
      if (card) {
        cards.push(card);
        continue;
      }
    }
    cards.push({ kind: 'word', word, examples });
  }

  return shuffle(cards);
}
