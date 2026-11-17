/**
 * AutoSave and Save in a Citadel Docs document, on the real stack, two people. With AutoSave
 * off, what the admin types stays on the admin's device ("Saved to this device") and the member,
 * who watches the same document, gets none of it; Ctrl/Cmd+S sends it ("All changes saved") and
 * the member's own copy then says it. Turning AutoSave back on sends what was typed since. With
 * AutoSave on and the server unreachable, edits wait on the device ("Offline") and go when it is
 * back.
 *
 * What the member has is read as the member would read it: their own "Download as… → Plain
 * text". The admin's state is the title bar's status, the one place it is shown.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { adminMemberTest } from '../fixtures/multi-user.fixture.js';
import { createDocument, downloadedText, firstPage, openDocument } from '../lib/docs-document.js';
import { withServerUnreachable } from '../lib/server-link.js';

const STEP_MS = 30_000;
const SYNC_MS = 60_000;

// The indicator's label: shown as words for every state but "saved", where it names the icon.
const status = (page: Page): Locator => page.getByTestId('docs-save-status-label');
const autoSave = (page: Page): Locator => page.getByTestId('docs-autosave');

async function memberReads(member: Page, text: string): Promise<void> {
  await expect.poll(async (): Promise<string> => (await downloadedText(member)).trim(), {
    message: `the member's copy of the document should say "${text}"`,
    timeout: SYNC_MS,
  }).toBe(text);
}

adminMemberTest('with AutoSave off edits stay on the device until Save, and with the server gone they wait for it', async ({ admin, member }) => {
  adminMemberTest.setTimeout(600_000);
  const name = `Kept notes ${Date.now()}`;
  await createDocument(admin.page, name);
  await openDocument(admin.page, name);
  await openDocument(member.page, name);
  await expect(status(admin.page)).toHaveText('All changes saved', { timeout: STEP_MS });
  await expect(autoSave(admin.page)).toHaveAttribute('aria-checked', 'true');

  // Off: typed, kept on this device, not sent.
  await autoSave(admin.page).click();
  await expect(autoSave(admin.page)).toHaveAttribute('aria-checked', 'false');
  const first = `Kept by ${admin.username}`;
  await firstPage(admin.page).click();
  await admin.page.keyboard.type(first, { delay: 30 });
  await expect(status(admin.page)).toHaveText('Saved to this device', { timeout: STEP_MS });
  // The status says nothing went; the member's own copy agrees, still blank.
  expect((await downloadedText(member.page)).trim(), 'the member got edits that were never saved').toBe('');

  // Save: Ctrl/Cmd+S over the document sends them.
  await admin.page.keyboard.press('ControlOrMeta+s');
  await expect(status(admin.page)).toHaveText('All changes saved', { timeout: SYNC_MS });
  await memberReads(member.page, first);

  // Typed after the Save waits for the next one; turning AutoSave on is one.
  const second = ' and more';
  await admin.page.keyboard.type(second, { delay: 30 });
  await expect(status(admin.page)).toHaveText('Saved to this device', { timeout: STEP_MS });
  await autoSave(admin.page).click();
  await expect(autoSave(admin.page)).toHaveAttribute('aria-checked', 'true');
  await expect(status(admin.page)).toHaveText('All changes saved', { timeout: SYNC_MS });
  await memberReads(member.page, `${first}${second}`);

  // On, with the server unreachable: edits wait on the device and say so.
  const third = ' offline';
  await withServerUnreachable(admin.page, async (): Promise<void> => {
    await firstPage(admin.page).click();
    await admin.page.keyboard.press('End');
    await admin.page.keyboard.type(third, { delay: 30 });
    await expect(status(admin.page)).toHaveText('Offline', { timeout: STEP_MS });
  });
  await expect(status(admin.page)).toHaveText('All changes saved', { timeout: SYNC_MS });
  await memberReads(member.page, `${first}${second}${third}`);
});
