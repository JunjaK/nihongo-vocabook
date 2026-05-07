import { test, expect } from './fixtures/auth';

test.describe('Words (Supabase persistence)', () => {
  test('katakana word: hiragana query → finds katakana entry and click populates form', async ({ page }) => {
    // This pins TWO regressions that surfaced together:
    //
    // (1) API katakana variant matching. The IME on the search input runs
    //     `toHiragana`, so a user typing "ko-hi-" produces the hiragana
    //     "こーひー" — but the cached dictionary entry is "コーヒー" (katakana).
    //     The local-DB lookup used to do an exact match and miss; the API now
    //     also tries the katakana variant of every kana query.
    //
    // (2) Implicit `type="submit"` leak on the search button and result rows.
    //     On iOS Safari, clicking a result fired form submission against the
    //     empty `required` fields and the native HTML5 validation popup
    //     blocked the user (see the screenshot the user shared). Desktop
    //     Chromium happens to swallow that submission silently so we cannot
    //     observe it via events; we pin the fix as a static attribute check.
    await page.goto('/words/create');

    // Hiragana query — exactly what wanakana's IMEMode='toHiragana' produces
    // when a user types "ko-hi-" expecting katakana コーヒー.
    await page.getByTestId('word-search-input').fill('こーひー');
    await page.getByTestId('word-search-button').click();

    const firstResult = page.getByTestId('word-search-result-0');
    await expect(firstResult).toBeVisible({ timeout: 10_000 });

    // (2) Static attribute check — cross-browser-stable signal that the
    // type="submit" leak is plugged.
    const buttonTypes = await page.evaluate(() => ({
      search: (document.querySelector('[data-testid="word-search-button"]') as HTMLButtonElement | null)?.type,
      result: (document.querySelector('[data-testid="word-search-result-0"]') as HTMLButtonElement | null)?.type,
    }));
    expect(buttonTypes.search).toBe('button');
    expect(buttonTypes.result).toBe('button');

    await firstResult.click();

    // Click flow works end-to-end and stays on /words/create.
    await expect(page).toHaveURL(/\/words\/create/);
    await expect(page.getByTestId('word-form-term')).not.toHaveValue('');
    await expect(page.getByTestId('word-form-reading')).not.toHaveValue('');

    // (1) The hiragana query must have surfaced a katakana entry — i.e. at
    // least one of {term, reading} is in the katakana range. Without the
    // variant fix the local-DB lookup misses and Jisho's lenient match would
    // still return something for some queries, but pinning this assertion
    // directly proves the cross-kana lookup wired up correctly.
    const populated = await page.evaluate(() => ({
      term: (document.querySelector('[data-testid="word-form-term"]') as HTMLInputElement)?.value,
      reading: (document.querySelector('[data-testid="word-form-reading"]') as HTMLInputElement)?.value,
    }));
    const KATAKANA = /[ァ-ヶー]/;
    expect(KATAKANA.test(populated.term) || KATAKANA.test(populated.reading)).toBe(true);
  });

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
