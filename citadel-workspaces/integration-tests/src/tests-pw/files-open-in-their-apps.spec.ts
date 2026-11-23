/**
 * A file opens in the app registered for its extension, from the file browser and from a chat
 * attachment: a .md in Citadel Docs, an .ics in the Calendar. The .ics is reviewed before anything
 * is saved: Cancel adds nothing, Import adds its event to the member's own calendar.
 *
 * The admin uploads both files to Server Storage and shares both into a fresh office's channel.
 * Each is opened from its menu ("Open in <app>"), never through a test hook; only what a person sees
 * is asserted: the menu entries, the opened document, the review's title and count, and the event
 * in the Calendar afterwards.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { adminMemberTest } from '../fixtures/multi-user.fixture.js';
import { chooseFromNewMenu, createOffice, fmItem, navigateToOffice, openFileManagerAt, openItemMenu, switchToChatTab } from '../lib/index.js';

const stamp: number = Date.now();
const OFFICE: string = `Opens ${stamp}`;
const MD: string = `minutes-${stamp}.md`;
const ICS: string = `standup-${stamp}.ics`;
const TITLE: string = `Standup ${stamp}`;
/** The document's text: the spec's own data, stamped, so it can only be this upload's. */
const BODY: string = `The boiler was serviced on run ${stamp}.`;
const MD_BYTES: Buffer = Buffer.from(`# Minutes ${stamp}\n\n${BODY}\n`);
/** An iCalendar UTC stamp (`20261201T090000Z`) for `ms`. */
const icsStamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
/** Soon, so the event is on the Calendar's opening view (this month, or the agenda's first days). */
const START: number = stamp + 10 * 60_000;
const ICS_BYTES: Buffer = Buffer.from([
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//citadel//opens//EN',
  'BEGIN:VEVENT', `UID:standup-${stamp}@example.com`, `DTSTAMP:${icsStamp(stamp)}`,
  `DTSTART:${icsStamp(START)}`, `DTEND:${icsStamp(START + 15 * 60_000)}`, `SUMMARY:${TITLE}`, 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n'));

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

async function reviewsThenImports(page: Page): Promise<void> {
  const review: Locator = page.getByTestId('ics-import-review');
  await expect(review).toBeVisible({ timeout: 60_000 });
  await expect(review.getByRole('heading')).toHaveText(`Import ${ICS}`);
  await expect(review.getByTestId('ics-import-count')).toHaveText('1 event to add to your own calendar.');
  await expect(review.getByTestId('ics-import-event')).toContainText(TITLE);
  await expect(review.getByTestId('ics-import-confirm')).toHaveText('Import 1 event');
  await review.getByTestId('ics-import-confirm').click();
  await expect(review).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('calendar-pane').getByText(TITLE).first()).toBeVisible({ timeout: 30_000 });
}

adminMemberTest('a .md opens in Docs and an .ics in the Calendar, from the file browser and from chat', async ({ admin }) => {
  adminMemberTest.setTimeout(480_000);
  const page: Page = admin.page;

  await openFileManagerAt(page, 'section=files');
  await upload(page, MD, 'text/markdown', MD_BYTES);
  await upload(page, ICS, 'text/calendar', ICS_BYTES);

  const md: Locator = await openEntry(page, MD);
  await expect(md).toHaveText('Open in Citadel Docs');
  await md.click();
  await expect(page.getByTestId('docs-file-screen').getByText(BODY)).toBeVisible({ timeout: 120_000 });
  await page.getByTestId('docs-file-back').click();

  // Cancel is the control: the review writes nothing, so the event is not in the Calendar after it.
  const ics: Locator = await openEntry(page, ICS);
  await expect(ics).toHaveText('Open in Calendar');
  await ics.click();
  const review: Locator = page.getByTestId('ics-import-review');
  await expect(review).toBeVisible({ timeout: 60_000 });
  await review.getByTestId('ics-import-cancel').click();
  await expect(review).toHaveCount(0);
  // The pane is shown first, so an absent title is the Calendar's answer, not a pane not yet drawn.
  await expect(page.getByTestId('calendar-pane')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('calendar-pane').getByText(TITLE)).toHaveCount(0);

  await page.goBack();
  await (await openEntry(page, ICS)).click();
  await reviewsThenImports(page);

  // From a channel: both files shared into a fresh office's chat, each opened from its card's menu.
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
  await expect(page.getByTestId('chat-file-opened').getByText(BODY)).toBeVisible({ timeout: 120_000 });
  await page.keyboard.press('Escape');

  const icsCard: Locator = page.getByTestId('server-file').filter({ hasText: ICS });
  await icsCard.getByTestId('chat-file-menu').click();
  await expect(page.getByTestId('chat-file-open-in-app')).toHaveText('Open in Calendar');
  await page.getByTestId('chat-file-open-in-app').click();
  // The review naming this file is what proves the chat card handed it to the Calendar.
  await reviewsThenImports(page);
});
