/**
 * A Word file in workspace storage opens in Citadel Docs and downloads as a PDF, end to end:
 * the admin uploads the 10-page benchmark corpus document to Server Storage, chooses "Open in
 * Citadel Docs" from its menu, and the status bar counts its ten pages. The agent pulled the
 * file and handed its bytes to the page (ReadPulledFileChunk); the engine imported it in its
 * worker. "Download as…" → PDF then finishes a real download of a PDF.
 *
 * Only what a person sees is asserted: the menu entry, the page count, the announced result
 * and the downloaded file. Nothing is reached through a test hook.
 */
import { test, expect, type BrowserContext, type Download, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adminCredentials,
  chooseFromNewMenu,
  clearBrowserStorage,
  closeAnyModals,
  fmItem,
  loginAfterDisconnect,
  openFileManagerAt,
  openItemMenu,
  waitForAppReady,
  waitForWorkspaceLoaded,
} from '../lib/index.js';
import { config } from '../lib/config.js';

const HERE: string = dirname(fileURLToPath(import.meta.url));
/** citadel-docs crates/cdoc-bench/corpus/10p.docx; see assets/docs/LICENSES.md. */
const CORPUS_10P: Buffer = readFileSync(join(HERE, '..', '..', 'assets', 'docs', '10p.docx'));
const DOCX_MIME: string = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Whether the item's menu offers "Open in Citadel Docs"; the menu is closed again. */
async function offersDocs(page: Page, name: string): Promise<boolean> {
  const menu: Locator | null = await openItemMenu(page, name);
  if (menu === null) return false;
  const offered: boolean = await menu.getByTestId('vfs-open-in-docs').isVisible();
  await page.keyboard.press('Escape');
  return offered;
}

test.describe.serial('A workspace .docx in Citadel Docs', () => {
  let context: BrowserContext;
  let page: Page;
  const name: string = `ten-pages-${Date.now()}.docx`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    context = await browser.newContext({ acceptDownloads: true });
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

  test('uploaded to Server Storage, it is offered to Citadel Docs', async () => {
    await openFileManagerAt(page, 'section=files');
    await expect(fmItem(page, 'Sent Files')).toBeVisible({ timeout: 30_000 });
    // Armed before the click, or the chooser event races it. Marked handled: when the menu throws
    // or offers no upload the chooser never comes, and its timeout is not the error to report.
    const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
    chooser.catch(() => undefined);
    // Offered only once the server has said it stores files; when it is not, the menu says why.
    if (!(await chooseFromNewMenu(page, 'upload'))) {
      const why: Locator = page.getByTestId('vfs-upload-unavailable');
      throw new Error(`New → Upload files was not offered${await why.count() > 0 ? `: ${await why.innerText()}` : ''}`);
    }
    await (await chooser).setFiles({ name, mimeType: DOCX_MIME, buffer: CORPUS_10P });
    // The file appears once the server has its bytes; a refused upload says why in an error
    // toast instead. Waiting on either, and failing on the refusal with its own words, says
    // which, rather than timing out on a file that will never come.
    const refused: Locator = page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: `Failed to upload ${name}` });
    await expect(fmItem(page, name).or(refused)).toBeVisible({ timeout: 30_000 });
    if (await refused.count() > 0) throw new Error(`the upload was refused: ${await refused.first().innerText()}`);
    await expect(fmItem(page, name)).toBeVisible();
    // Offered once the upload is stored on the server, not while it is still pending.
    await expect.poll(() => offersDocs(page, name), { timeout: 60_000, message: `"${name}" should offer Open in Citadel Docs once stored` }).toBe(true);
  });

  test('opens read-only with its ten pages counted', async () => {
    const menu: Locator | null = await openItemMenu(page, name);
    expect(menu, `the menu of "${name}" should open`).not.toBeNull();
    const open: Locator = menu!.getByTestId('vfs-open-in-docs');
    await expect(open).toHaveText('Open in Citadel Docs');
    await open.click();
    await expect(page.getByRole('button', { name: /^Back to / })).toBeVisible({ timeout: 15_000 });
    // The pull, the chunked read and the import all happen before the first page is counted.
    await expect(page.getByTestId('docs-page-status')).toHaveText(/^Page \d+ of 10$/, { timeout: 120_000 });
    await expect(page.getByText(`Opening ${name}:`)).toBeVisible();
  });

  test('downloads as a PDF', async () => {
    const trigger: Locator = page.getByTestId('docs-download-as');
    await expect(trigger).toHaveAccessibleName('Download as…', { timeout: 15_000 });
    await trigger.click();
    const pdf: Locator = page.getByTestId('docs-download-as-pdf');
    await expect(pdf).toHaveText('PDF (.pdf)');
    // Awaited together with the click that starts it, so a failed click is the error raised.
    const [download]: [Download, void] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), pdf.click()]);
    expect(download.suggestedFilename()).toBe(name.replace(/\.docx$/, '.pdf'));
    const path: string | null = await download.path();
    expect(path, 'the download should finish').not.toBeNull();
    const bytes: Buffer = readFileSync(path!);
    expect(bytes.length, 'the PDF should not be empty').toBeGreaterThan(1_000);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // A PDF's writer reports no losses, so the bar names the download with no report after it
    // (no "…: N things"); the live region announces it too.
    const pdfName: string = name.replace(/\.docx$/, '.pdf');
    await expect(page.getByTestId('docs-export-report')).toHaveText(`Downloaded ${pdfName}`, { timeout: 15_000 });
    await expect(page.getByTestId('docs-export-status')).toHaveText(`Downloaded ${pdfName}.`);
  });
});
