import { test, expect } from './fixtures/auth';

test.describe('Profile (Supabase persistence)', () => {
  test('update nickname → persists across reload + reflected on settings', async ({ page }) => {
    const nickname = `E2E ${Date.now()}`;

    await page.goto('/settings/profile');
    const input = page.getByTestId('profile-nickname-input');
    await expect(input).toBeVisible();
    await input.fill(nickname);

    const save = page.getByTestId('profile-save-button');
    await save.click();
    await expect(save).toBeEnabled({ timeout: 10_000 });

    // Reload — verify nickname stuck in DB
    await page.reload();
    await expect(page.getByTestId('profile-nickname-input')).toHaveValue(nickname, {
      timeout: 10_000,
    });

    // Settings landing should show the updated nickname in account row
    await page.goto('/settings');
    await expect(page.getByTestId('settings-profile-link')).toContainText(nickname);
  });
});
