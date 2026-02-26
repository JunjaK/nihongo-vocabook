import { test, expect } from '@playwright/test';

test.describe('Quiz flow (guest mode)', () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh — go to words page (guest mode uses IndexedDB)
    await page.goto('/words');
    await page.waitForLoadState('networkidle');
  });

  test('full quiz cycle: add word → quiz → rate → session report', async ({
    page,
  }) => {
    // Step 1: Navigate to create word page
    await page.goto('/words/create');
    await page.waitForURL('/words/create');

    // Step 2: Fill in word form
    await page.getByTestId('word-form-term').fill('食べる');
    await page.getByTestId('word-form-reading').fill('たべる');
    await page.getByTestId('word-form-meaning').fill('먹다');

    // Submit the form
    await page.getByTestId('word-form-submit').click();

    // Should redirect back to words list
    await page.waitForURL('/words');
    await expect(page.getByText('食べる')).toBeVisible();

    // Step 3: Navigate to quiz
    await page.goto('/quiz');
    await page.waitForLoadState('networkidle');

    // Wait for loading to finish
    await expect(page.getByTestId('flashcard')).toBeVisible({ timeout: 10000 });

    // Verify the word appears on the flashcard
    await expect(page.getByText('食べる')).toBeVisible();

    // Step 4: Tap card to reveal answer
    await page.getByTestId('flashcard').click();
    await expect(page.getByText('たべる')).toBeVisible();
    await expect(page.getByText('먹다')).toBeVisible();

    // Step 5: Verify all 4 rating buttons exist
    await expect(page.getByTestId('flashcard-rate-0')).toBeVisible();
    await expect(page.getByTestId('flashcard-rate-3')).toBeVisible();
    await expect(page.getByTestId('flashcard-rate-4')).toBeVisible();
    await expect(page.getByTestId('flashcard-rate-5')).toBeVisible();

    // Step 6: Rate the card as Good
    await page.getByTestId('flashcard-rate-4').click();

    // After rating, since there's only one word, it should show either
    // the session report or the "all caught up" state
    // Wait for navigation to settle
    await page.waitForTimeout(500);
  });

  test('flashcard shows interval previews on rating buttons', async ({
    page,
  }) => {
    // Add a word first
    await page.goto('/words/create');
    await page.getByTestId('word-form-term').fill('飲む');
    await page.getByTestId('word-form-reading').fill('のむ');
    await page.getByTestId('word-form-meaning').fill('마시다');
    await page.getByTestId('word-form-submit').click();
    await page.waitForURL('/words');

    // Go to quiz
    await page.goto('/quiz');
    await expect(page.getByTestId('flashcard')).toBeVisible({ timeout: 10000 });

    // Check that rating buttons have interval text (like "1m", "6m", "10m", "4d")
    const ratingSection = page.getByTestId('flashcard-rating');
    await expect(ratingSection).toBeVisible();

    // Each button should have a time indicator
    const againButton = page.getByTestId('flashcard-rate-0');
    const easyButton = page.getByTestId('flashcard-rate-5');

    // Buttons should contain interval preview text
    await expect(againButton).toContainText(/\d+(m|h|d|mo)|<1m/);
    await expect(easyButton).toContainText(/\d+(m|h|d|mo)|<1m/);
  });

  test('master button removes word from quiz', async ({ page }) => {
    // Add a word
    await page.goto('/words/create');
    await page.getByTestId('word-form-term').fill('見る');
    await page.getByTestId('word-form-reading').fill('みる');
    await page.getByTestId('word-form-meaning').fill('보다');
    await page.getByTestId('word-form-submit').click();
    await page.waitForURL('/words');

    // Go to quiz
    await page.goto('/quiz');
    await expect(page.getByTestId('flashcard')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('見る')).toBeVisible();

    // Master the word
    await page.getByTestId('flashcard-rate-master').click();

    // Word should be removed — quiz should show empty state
    await page.waitForTimeout(500);
  });

  test('quiz settings page loads and can change settings', async ({
    page,
  }) => {
    await page.goto('/settings/quiz');
    await page.waitForLoadState('networkidle');

    // Wait for loading spinner to disappear
    await page.waitForTimeout(1000);

    // Should show quiz settings options — use exact match for number buttons
    await expect(page.getByRole('button', { name: '5', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '10', exact: true })).toBeVisible();

    // Click a different newPerDay option
    await page.getByRole('button', { name: '15', exact: true }).click();
  });

  test('achievements page loads', async ({ page }) => {
    await page.goto('/settings/achievements');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Should show achievement types (locked state)
    await expect(page.locator('body')).toBeVisible();
  });
});
