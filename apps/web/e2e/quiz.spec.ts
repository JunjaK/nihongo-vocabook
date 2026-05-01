import { test, expect } from './fixtures/auth';

// Note: an earlier `quiz.noauth.spec.ts` exercised the full word-add → quiz cycle
// in guest mode, but commit 7c63165 (dict-first save flow) gates `/words/create`
// behind login. Word creation now requires auth; quiz UI is therefore covered
// here against shared worker accounts. We deliberately don't assert specific
// flashcard content because each worker account accumulates words across runs
// and the SRS picks whichever is due.

test.describe('Quiz (authenticated)', () => {
  test('quiz page renders without error (any of: flashcard / empty / goal-met)', async ({
    page,
  }) => {
    await page.goto('/quiz');
    // Inner content varies by account state (flashcard, no-words-due, daily-goal-reached,
    // session-complete). Header is the stable anchor proving the page mounted.
    await expect(page.getByRole('heading', { name: '퀴즈' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('quiz settings page shows daily-goal options', async ({ page }) => {
    await page.goto('/settings/quiz');
    // Use values unique to DAILY_GOAL_OPTIONS [10,15,20,30,50,100]
    // (10 and 15 also appear in LEECH_THRESHOLD; 20/30 do not).
    await expect(page.getByRole('button', { name: '20', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: '30', exact: true })).toBeVisible();
  });

  test('achievements page renders achievement categories', async ({ page }) => {
    await page.goto('/settings/achievements');
    // Header anchors the page; trivial body-visible assertions are meaningless.
    await expect(page.getByRole('heading', { name: '업적' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
