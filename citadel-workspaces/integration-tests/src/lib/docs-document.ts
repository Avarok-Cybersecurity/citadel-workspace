/**
 * A Citadel Docs document as a person reaches it: created from a node's menu, opened from the
 * sidebar, and read back through "Download as… → Plain text". Shared by the Docs specs.
 */
import { readFileSync } from 'node:fs';
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import { openSelectedNodeMenu, revealNode, selectRoot } from './focused-tree.js';

const STEP_MS = 30_000;
/** The click that starts a download and the export after it, so a stuck click times out first and is the error raised. */
const DOWNLOAD_MS = 2 * STEP_MS;

export const firstPage = (page: Page): Locator => page.getByRole('group', { name: /^Page 1 of / });

export async function createDocument(page: Page, name: string): Promise<void> {
  const parentId: string | null = (await selectRoot(page)) === null ? null : await openSelectedNodeMenu(page);
  expect(parentId, 'no node menu could be opened to create a document in').not.toBeNull();
  const entry: Locator = page.getByTestId(`new-document-${parentId}`);
  await expect(entry, 'the workspace root offers no new document').not.toHaveAttribute('data-disabled', { timeout: STEP_MS });
  await entry.click();
  const dialog: Locator = page.getByTestId('new-document-dialog');
  await dialog.getByTestId('new-document-app-docs').click();
  // Where the root admits more than one level, the dialog asks which; any one will do.
  const levels: Locator = dialog.getByTestId('new-document-level').getByRole('radio');
  if ((await levels.count()) > 0) await levels.first().click();
  await dialog.getByTestId('new-document-name').fill(name);
  await dialog.getByTestId('new-document-create').click();
  await expect(dialog).toBeHidden({ timeout: STEP_MS });
}

/**
 * The document as the person's own "Download as… → Plain text" writes it, as a person does it:
 * the menu opens, the entry is chosen, the menu closes. Safe to call back to back: a press on
 * the trigger while the last menu is still animating closed is swallowed (Radix keeps the
 * closing menu's outside-press dismissal live until its exit animation ends), so it waits for
 * that menu to be gone first. The download is awaited together with the click that starts it,
 * so no wait is left behind to reject unhandled, and a failed click is the error raised.
 */
export async function downloadedText(page: Page): Promise<string> {
  const trigger: Locator = page.getByTestId('docs-download-as');
  const plainText: Locator = page.getByTestId('docs-download-as-txt');
  await expect(plainText, 'the last "Download as…" menu never finished closing').toHaveCount(0, { timeout: STEP_MS });
  await trigger.click();
  await expect(trigger, 'the "Download as…" menu did not open').toHaveAttribute('data-state', 'open', { timeout: STEP_MS });
  const [download]: [Download, void] = await Promise.all([
    page.waitForEvent('download', { timeout: DOWNLOAD_MS }),
    plainText.click({ timeout: STEP_MS }),
  ]);
  await expect(trigger, 'choosing Plain text did not close the menu').toHaveAttribute('data-state', 'closed', { timeout: STEP_MS });
  const path: string | null = await download.path();
  expect(path, 'the plain-text download should finish').not.toBeNull();
  return readFileSync(path ?? '', 'utf-8');
}

/** Select the document in the sidebar, as a person would, and wait for its pages. */
export async function openDocument(page: Page, name: string): Promise<void> {
  expect(await revealNode(page, name, STEP_MS), `"${name}" never appeared in the sidebar`).not.toBeNull();
  await expect(page.getByTestId('document-host')).toHaveAttribute('data-app', 'docs', { timeout: STEP_MS });
  await expect(firstPage(page)).toBeVisible({ timeout: STEP_MS });
}
