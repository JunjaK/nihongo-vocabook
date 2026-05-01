import { test, expect } from './fixtures/auth';

test.describe('Authenticated session (worker account)', () => {
  test('settings shows worker account email', async ({ page, workerAccountEmail }) => {
    await page.goto('/settings');
    const profileLink = page.getByTestId('settings-profile-link');
    await expect(profileLink).toBeVisible();
    await expect(profileLink).toContainText(workerAccountEmail);
  });

  test('words page renders without redirecting to login', async ({ page }) => {
    await page.goto('/words');
    await expect(page).toHaveURL(/\/words(\?|$)/);
  });
});
