import { test as base, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUTH_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.auth');
const PASSWORD = process.env.E2E_PASSWORD ?? 'test123!';

type AuthWorkerFixtures = {
  workerStorageState: string;
  workerAccountEmail: string;
};

// Empty test-scope fixtures (`{}`) so Playwright's built-in `storageState`
// option keeps its native type when we override it below.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const test = base.extend<{}, AuthWorkerFixtures>({
  storageState: ({ workerStorageState }, use) => use(workerStorageState),

  workerAccountEmail: [
    async ({}, use, workerInfo) => {
      await use(`e2e${workerInfo.parallelIndex + 1}@test.com`);
    },
    { scope: 'worker' },
  ],

  workerStorageState: [
    async ({ browser, workerAccountEmail }, use, workerInfo) => {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
      const file = path.join(AUTH_DIR, `${workerAccountEmail}.json`);

      if (!fs.existsSync(file)) {
        const baseURL = workerInfo.project.use.baseURL;
        const page = await browser.newPage({ storageState: undefined, baseURL });
        await page.goto('/login');
        await page.getByTestId('login-email-input').fill(workerAccountEmail);
        await page.getByTestId('login-password-input').fill(PASSWORD);
        await page.getByTestId('login-submit-button').click();
        await page.waitForURL('**/words', { timeout: 15_000 });
        await page.context().storageState({ path: file });
        await page.close();
      }

      await use(file);
    },
    { scope: 'worker' },
  ],
});

export { expect };
