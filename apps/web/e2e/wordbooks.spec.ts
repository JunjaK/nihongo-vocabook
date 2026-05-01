import { test, expect } from './fixtures/auth';

test.describe('Wordbooks (Supabase persistence)', () => {
  test('create wordbook → visible after reload', async ({ page }) => {
    const name = `E2E Wordbook ${Date.now()}`;

    await page.goto('/wordbooks');
    await page.getByTestId('wordbooks-create-button').click();
    await page.waitForURL('/wordbooks/create');

    await page.getByTestId('wordbook-name-input').fill(name);
    await page.getByTestId('wordbook-form-submit').click();
    await page.waitForURL('/wordbooks');

    await page.reload();
    await expect(page.getByTestId('wordbooks-create-button')).toBeVisible();

    const search = page.getByTestId('list-toolbar-search-input');
    await search.fill(name);
    await search.press('Enter');

    await expect(page.getByText(name)).toBeVisible();
  });
});
