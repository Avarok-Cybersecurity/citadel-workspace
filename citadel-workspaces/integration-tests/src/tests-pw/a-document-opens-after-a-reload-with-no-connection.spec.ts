/**
 * A document opens after a reload with no connection to the server: the admin opens a Citadel
 * Docs document (the tree the server listed is kept on this device), the server is made
 * unreachable, and the page is reloaded. The document opens from the kept tree, under a notice
 * that says the tree is the kept one and from when. Once the server is back the live tree takes
 * over and the notice goes.
 *
 * Only what a person sees is asserted: the notice, the document's app and its first page.
 */
import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  adminCredentials,
  clearBrowserStorage,
  closeAnyModals,
  loginAfterDisconnect,
  waitForAppReady,
  waitForWorkspaceLoaded,
  withServerUnreachable,
} from '../lib/index.js';
import { createDocument, firstPage, openDocument } from '../lib/docs-document.js';
import { config } from '../lib/config.js';

const STEP_MS = 30_000;
/** The reload claims the session afresh and imports cdoc before the first page is painted. */
const OPEN_MS = 120_000;

test.describe.serial('A document with the server out of reach', () => {
  let context: BrowserContext;
  let page: Page;
  const name: string = `Offline notes ${Date.now()}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await waitForAppReady(page, 60_000);
    const admin = adminCredentials();
    expect(await loginAfterDisconnect(page, admin.username, admin.password, null, config.WORKSPACE_SERVER), `could not sign in as ${admin.username}`).toBe(true);
    expect(await waitForWorkspaceLoaded(page, 60_000), 'the workspace should finish loading').toBe(true);
    await closeAnyModals(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('opens live, with no offline notice', async () => {
    await createDocument(page, name);
    await openDocument(page, name);
    await expect(page.getByTestId('workspace-offline-notice')).toHaveCount(0);
  });

  test('opens after a reload with no connection, labelled as the kept tree', async () => {
    test.setTimeout(600_000);
    const notice: Locator = page.getByTestId('workspace-offline-notice');
    await withServerUnreachable(page, async (): Promise<void> => {
      await page.reload({ waitUntil: 'commit' });
      await expect(notice).toHaveText(/^Offline — showing the tree as of .+\.$/, { timeout: OPEN_MS });
      await expect(page.getByTestId('document-host')).toHaveAttribute('data-app', 'docs', { timeout: STEP_MS });
      await expect(page.getByRole('heading', { name })).toBeVisible();
      await expect(firstPage(page)).toBeVisible({ timeout: OPEN_MS });
    });
    // Seen inside the step, so its going is the live tree taking over, not a notice never shown.
    await expect(notice).toHaveCount(0, { timeout: OPEN_MS });
    await expect(page.getByTestId('document-host')).toHaveAttribute('data-app', 'docs');
  });
});
