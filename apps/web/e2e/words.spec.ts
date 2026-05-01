import { test, expect } from './fixtures/auth';

test.describe('Words (Supabase persistence)', () => {
  test('create word via dictionary → visible after Supabase round-trip', async ({ page }) => {
    // term/reading are readonly — they can only be set by dictionary lookup,
    // and the dict entry id (set on select) is what gates submit.
    await page.goto('/words/create');

    await page.getByTestId('word-search-input').fill('食べる');
    await page.getByTestId('word-search-button').click();
    const firstResult = page.getByTestId('word-search-result-0');
    await expect(firstResult).toBeVisible({ timeout: 10_000 });
    await firstResult.click();

    // After select, fields are populated and submit becomes enabled.
    await expect(page.getByTestId('word-form-meaning')).not.toHaveValue('');
    await page.getByTestId('word-form-submit').click();

    // Either redirects (newly created) or stays put with a DUPLICATE_WORD toast
    // when this worker account already has 食べる from a prior run. Both outcomes
    // mean the word lives in this account's Supabase data.
    await page.waitForURL('/words', { timeout: 5_000 }).catch(() => undefined);

    // Fresh navigation forces Supabase refetch; search verifies the row exists.
    await page.goto('/words');
    await expect(page.getByTestId('words-add-button')).toBeVisible();

    const search = page.getByTestId('list-toolbar-search-input');
    await search.fill('食べる');
    await search.press('Enter');

    await expect(page.getByTestId('word-card').first()).toBeVisible({ timeout: 10_000 });
  });
});
