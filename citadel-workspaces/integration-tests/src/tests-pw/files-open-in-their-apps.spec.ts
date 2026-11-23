/**
 * A file opens in the app registered for its extension, from the file browser and from a chat
 * attachment, and a file no app here opens is downloaded and says so.
 *
 * The admin uploads a .md and an .ics to Server Storage and shares both into a fresh office's
 * channel. The .md opens in Citadel Docs from each menu's "Open in <app>", never through a test hook.
 *
 * The .ics is the file with no app: this stack's server is built without the first-party signing key
 * (citadel-workspace-server-kernel/build.rs), so it provisions no Calendar and nothing registers
 * `ics`. Opening it downloads it and says why; its chat card offers Download and no Open. The
 * Calendar's own handling of an opened .ics is covered where a Calendar exists: the component test
 * an-opened-ics-is-reviewed-then-imported and the polish-harness check ics-import-review.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { adminMemberTest } from '../fixtures/multi-user.fixture.js';
import { chooseFromNewMenu, createOffice, fmItem, navigateToOffice, openFileManagerAt, openItemMenu, switchToChatTab } from '../lib/index.js';

const stamp: number = Date.now();
const OFFICE: string = `Opens ${stamp}`;
const MD: string = `minutes-${stamp}.md`;
const ICS: string = `standup-${stamp}.ics`;
/** The document's text: the spec's own data, stamped, so it can only be this upload's. */
const BODY: string = `The boiler was serviced on run ${stamp}.`;
const MD_BYTES: Buffer = Buffer.from(`# Minutes ${stamp}\n\n${BODY}\n`);
const ICS_BYTES: Buffer = Buffer.from([
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//citadel//opens//EN',
  'BEGIN:VEVENT', `UID:standup-${stamp}@example.com`, 'DTSTAMP:20261201T090000Z',
  'DTSTART:20261201T090000Z', 'DTEND:20261201T091500Z', `SUMMARY:Standup ${stamp}`, 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n'));

/**
 * Docs draws a document's text on a canvas, which no locator reads. What the page says in words is
 * asserted: the import report names this run's file, and one page was laid out from its bytes.
 */
async function showsTheDocument(where: Locator): Promise<void> {
  await expect(where.getByTestId('docs-page-status')).toHaveText(/^Page 1 of 1$/, { timeout: 120_000 });
  await expect(where.getByTestId('docs-import-report')).toContainText(`Opening ${MD}`);
}

async function upload(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  const chooser = page.waitForEvent('filechooser', { timeout: 15_000 });
  chooser.catch(() => undefined);
  if (!(await chooseFromNewMenu(page, 'upload'))) throw new Error('New → Upload files was not offered');
  await (await chooser).setFiles({ name, mimeType, buffer });
  await expect(fmItem(page, name)).toBeVisible({ timeout: 30_000 });
}

/** The item's "Open in <app>" entry once it is stored; the menu is left open. */
async function openEntry(page: Page, name: string): Promise<Locator> {
  let entry: Locator | null = null;
  await expect.poll(async (): Promise<boolean> => {
    const menu: Locator | null = await openItemMenu(page, name);
    if (menu === null) return false;
    if (await menu.getByTestId('vfs-open-in-app').isVisible()) {
      entry = menu.getByTestId('vfs-open-in-app');
      return true;
    }
    await page.keyboard.press('Escape');
    return false;
  }, { timeout: 60_000, message: `"${name}" should offer to open in its app once stored` }).toBe(true);
  return entry!;
}

adminMemberTest('a .md opens in Docs from the file browser and from chat, and an .ics no app opens is downloaded', async ({ admin }) => {
  adminMemberTest.setTimeout(480_000);
  const page: Page = admin.page;

  await openFileManagerAt(page, 'section=files');
  await upload(page, MD, 'text/markdown', MD_BYTES);
  await upload(page, ICS, 'text/calendar', ICS_BYTES);

  const md: Locator = await openEntry(page, MD);
  await expect(md).toHaveText('Open in Citadel Docs');
  await md.click();
  await showsTheDocument(page.getByTestId('docs-file-screen'));
  await page.getByTestId('docs-file-back').click();

  // The notice is given only for a stored file that no app opens (file-openers.ts activateFile): a
  // file still being stored downloads silently. So the notice is the proof, and the wait for it.
  const notice: Locator = page.locator('[data-sonner-toast]').filter({ hasText: 'no app here opens .ics files' });
  await expect(async (): Promise<void> => {
    await fmItem(page, ICS).dblclick();
    await expect(notice.first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  // From a channel: both files shared into a fresh office's chat, each reached from its card's menu.
  expect(await createOffice(page, admin.username, OFFICE), `the admin should create "${OFFICE}"`).toBe(true);
  expect(await navigateToOffice(page, admin.username, OFFICE)).toBe(true);
  expect(await switchToChatTab(page, admin.username)).toBe(true);
  for (const [name, mimeType, buffer] of [[MD, 'text/markdown', MD_BYTES], [ICS, 'text/calendar', ICS_BYTES]] as const) {
    await page.getByTestId('group-file-input').setInputFiles({ name, mimeType, buffer });
    await expect(page.getByTestId('server-file').filter({ hasText: name })).toBeVisible({ timeout: 120_000 });
  }
  const mdCard: Locator = page.getByTestId('server-file').filter({ hasText: MD });
  await mdCard.getByTestId('chat-file-menu').click();
  await expect(page.getByTestId('chat-file-open-in-app')).toHaveText('Open in Citadel Docs');
  await page.getByTestId('chat-file-open-in-app').click();
  await showsTheDocument(page.getByTestId('chat-file-opened'));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chat-file-opened')).toHaveCount(0);

  // The same menu that offered Docs for the .md: Download is shown, so the menu is open and drawn,
  // and it offers no app for the .ics.
  const icsCard: Locator = page.getByTestId('server-file').filter({ hasText: ICS });
  await icsCard.getByTestId('chat-file-menu').click();
  await expect(page.getByTestId('chat-file-download')).toBeVisible();
  await expect(page.getByTestId('chat-file-open-in-app')).toHaveCount(0);
});
