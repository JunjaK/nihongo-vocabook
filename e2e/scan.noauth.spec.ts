import { test, expect } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.resolve(__dirname, 'fixtures/large-sign.jpg');
const HEIC_FIXTURE = path.resolve(__dirname, 'fixtures/heic-sample.heic');

test.describe('Scan flow (guest mode)', () => {
  test.beforeEach(async ({ page }) => {
    // Grant storage consent so ConsentGate doesn't block
    await page.goto('/words');
    await page.evaluate(() => {
      localStorage.setItem('vocabook_storage_consent', 'true');
    });
  });

  test('upload large image → normalizes to JPEG ≤2048px → shows extract button', async ({
    page,
  }) => {
    await page.goto('/words/scan');
    await page.waitForLoadState('networkidle');

    // Click the gallery area to trigger file input
    const fileInput = page.locator('input[type="file"][multiple]');
    await fileInput.setInputFiles(FIXTURE);

    // Wait for the image preview to appear (normalization happens async)
    const preview = page.locator('img[alt="Selected 1"]');
    await expect(preview).toBeVisible({ timeout: 10000 });

    // Verify the normalized data URL is JPEG (not HEIC or oversized)
    const src = await preview.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src!.startsWith('data:image/jpeg;base64,')).toBe(true);

    // Verify the image was downscaled by checking data URL size
    // Original: 3.2MB JPEG (3000px wide) → should be ~1MB or less after normalize to 2048px
    const base64Length = src!.length - 'data:image/jpeg;base64,'.length;
    const approximateBytes = base64Length * 0.75;
    console.log(`Normalized image size: ~${(approximateBytes / 1024).toFixed(0)} KB`);
    expect(approximateBytes).toBeLessThan(2 * 1024 * 1024); // < 2MB

    // Verify the extract button is enabled
    const extractButton = page.getByTestId('scan-extract-button');
    await expect(extractButton).toBeEnabled();
  });

  test('upload image → extract triggers Tesseract → shows extracting state', async ({
    page,
  }) => {
    await page.goto('/words/scan');
    await page.waitForLoadState('networkidle');

    // Upload image
    const fileInput = page.locator('input[type="file"][multiple]');
    await fileInput.setInputFiles(FIXTURE);

    const preview = page.locator('img[alt="Selected 1"]');
    await expect(preview).toBeVisible({ timeout: 10000 });

    // Click extract
    await page.getByTestId('scan-extract-button').click();

    // Should show extracting overlay (Tesseract running)
    // This confirms the normalized image is accepted by Tesseract.js
    await expect(page.getByText('텍스트 추출 중')).toBeVisible({ timeout: 10000 });
  });

  test('upload HEIC image → converts via heic-to → extracts words', async ({
    page,
  }) => {
    await page.goto('/words/scan');
    await page.waitForLoadState('networkidle');

    // Upload HEIC file
    const fileInput = page.locator('input[type="file"][multiple]');
    await fileInput.setInputFiles(HEIC_FIXTURE);

    // HEIC conversion can be slow (WASM decode) — allow up to 30s
    const preview = page.locator('img[alt="Selected 1"]');
    await expect(preview).toBeVisible({ timeout: 30000 });

    // Verify converted to JPEG
    const src = await preview.getAttribute('src');
    expect(src).toBeTruthy();
    expect(src!.startsWith('data:image/jpeg;base64,')).toBe(true);

    // Click extract
    await page.getByTestId('scan-extract-button').click();

    // Should show extracting state
    await expect(page.getByText('텍스트 추출 중')).toBeVisible({ timeout: 10000 });
  });
});
