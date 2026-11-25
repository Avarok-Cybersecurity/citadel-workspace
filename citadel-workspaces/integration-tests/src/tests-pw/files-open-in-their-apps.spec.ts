/**
 * A file opens in the app registered for its extension, from the file browser and from a chat
 * attachment, and a file no app here opens is downloaded and says so.
 *
 * The admin uploads a .md, an .ics and an .xyz to Server Storage and shares a .md, another .ics and
 * the .xyz into a fresh office's channel. Each is reached from its menu's "Open in <app>", never
 * through a test hook. The .md opens in Citadel Docs. The .ics opens in the Calendar, which this
 * stack's server provisions as production does (signed with the CI seed, scripts/ci-stack.sh):
 * the member answers its question once, reviews the file, imports it, and the event is in the
 * Calendar. Nothing registers .xyz: opening it downloads it and says why, and its chat card offers
 * Download and no Open.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { adminMemberTest } from '../fixtures/multi-user.fixture.js';
import { chooseFromNewMenu, createOffice, fmItem, navigateToOffice, openFileManagerAt, openItemMenu, switchToChatTab } from '../lib/index.js';

const stamp: number = Date.now();
const OFFICE: string = `Opens ${stamp}`;
const MD: string = `minutes-${stamp}.md`;
const ICS: string = `standup-${stamp}.ics`;
const CHAT_ICS: string = `review-${stamp}.ics`;
const XYZ: string = `bundle-${stamp}.xyz`;
const XYZ_BYTES: Buffer = Buffer.from(`not a format any app here reads ${stamp}\n`);
/** The document's text: the spec's own data, stamped, so it can only be this upload's. */
const BODY: string = `The boiler was serviced on run ${stamp}.`;
const MD_BYTES: Buffer = Buffer.from(`# Minutes ${stamp}\n\n${BODY}\n`);
/** ICS time: UTC, to the second. */
const icsTime = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
/**
 * One event spanning from a day before this run to two days after it: whatever zone the Calendar
 * shows and whenever its "today" is taken, today's view holds it.
 */
function icsOf(title: string): Buffer {
  const day: number = 86_400_000;
  return Buffer.from([
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//citadel//opens//EN',
    'BEGIN:VEVENT', `UID:${title.replace(/\s/g, '-')}@example.com`, `DTSTAMP:${icsTime(stamp)}`,
    `DTSTART:${icsTime(stamp - day - 2 * 3_600_000)}`, `DTEND:${icsTime(stamp + 2 * day + 2 * 3_600_000)}`, `SUMMARY:${title}`, 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n'));
}
const ICS_TITLE: string = `Standup ${stamp}`;
const CHAT_ICS_TITLE: string = `Review ${stamp}`;

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

/**
 * The Calendar tab a file was handed to: the member's one question answered the first time, the
 * file reviewed (its name, its one event), imported, and the event shown in the Calendar.
 */
async function importsInTheCalendar(page: Page, name: string, title: string): Promise<void> {
  // The first open asks the member once to start the Calendar, then which zone it shows; neither
  // is asked again, so each is answered only when it is the step on screen.
  const allow: Locator = page.getByTestId('app-zone-allow');
  const zone: Locator = page.getByTestId('calendar-zone-question');
  const review: Locator = page.getByTestId('ics-import-review');
  await expect(allow.or(zone).or(review)).toBeVisible({ timeout: 60_000 });
  if (await allow.isVisible()) {
    await expect(allow).toHaveText('Allow and start Calendar');
    await allow.click();
    await expect(zone.or(review)).toBeVisible({ timeout: 60_000 });
  }
  if (await zone.isVisible()) {
    const save: Locator = zone.getByTestId('calendar-zone-save');
    await expect(save).toHaveText('Show my Calendar');
    await save.click();
  }
  await expect(review.getByRole('heading', { name: `Import ${name}` })).toBeVisible({ timeout: 60_000 });
  await expect(review.getByTestId('ics-import-count')).toHaveText('1 event to add to your own calendar.');
  await expect(review.getByTestId('ics-import-event')).toHaveCount(1);
  await expect(review.getByTestId('ics-import-event')).toContainText(title);
  const confirm: Locator = review.getByTestId('ics-import-confirm');
  await expect(confirm).toHaveText('Import 1 event');
  await confirm.click();
  await expect(review).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: `1 event from ${name} added to your calendar` }).first()).toBeVisible();
  const chip: Locator = page.getByTestId('calendar-tab').getByTestId('calendar-event-chip').filter({ hasText: title });
  await expect(chip.first()).toBeVisible({ timeout: 30_000 });
}

adminMemberTest('a .md opens in Docs and an .ics in the Calendar, from the file browser and from chat, and an .xyz no app opens is downloaded', async ({ admin }) => {
  adminMemberTest.setTimeout(480_000);
  const page: Page = admin.page;

  // First: an app on a workspace-wide install opens a file in a page's tab (open-installed.ts), so
  // the workspace needs a page before anything is opened in the Calendar.
  expect(await createOffice(page, admin.username, OFFICE), `the admin should create "${OFFICE}"`).toBe(true);

  await openFileManagerAt(page, 'section=files');
  await upload(page, MD, 'text/markdown', MD_BYTES);
  await upload(page, ICS, 'text/calendar', icsOf(ICS_TITLE));
  await upload(page, XYZ, 'application/octet-stream', XYZ_BYTES);

  const md: Locator = await openEntry(page, MD);
  await expect(md).toHaveText('Open in Citadel Docs');
  await md.click();
  await showsTheDocument(page.getByTestId('docs-file-screen'));
  await page.getByTestId('docs-file-back').click();

  // The notice is given only for a stored file that no app opens (file-openers.ts activateFile): a
  // file still being stored downloads silently. So the notice is the proof, and the wait for it.
  const notice: Locator = page.locator('[data-sonner-toast]').filter({ hasText: 'no app here opens .xyz files' });
  await expect(async (): Promise<void> => {
    await fmItem(page, XYZ).dblclick();
    await expect(notice.first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  const ics: Locator = await openEntry(page, ICS);
  await expect(ics).toHaveText('Open in Calendar');
  await ics.click();
  await importsInTheCalendar(page, ICS, ICS_TITLE);

  // From a channel: the files shared into the fresh office's chat, each reached from its card's menu.
  expect(await navigateToOffice(page, admin.username, OFFICE)).toBe(true);
  expect(await switchToChatTab(page, admin.username)).toBe(true);
  for (const [name, mimeType, buffer] of [[MD, 'text/markdown', MD_BYTES], [XYZ, 'application/octet-stream', XYZ_BYTES], [CHAT_ICS, 'text/calendar', icsOf(CHAT_ICS_TITLE)]] as const) {
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
  // and it offers no app for the .xyz.
  const xyzCard: Locator = page.getByTestId('server-file').filter({ hasText: XYZ });
  await xyzCard.getByTestId('chat-file-menu').click();
  await expect(page.getByTestId('chat-file-download')).toBeVisible();
  await expect(page.getByTestId('chat-file-open-in-app')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('chat-file-download')).toHaveCount(0);

  const icsCard: Locator = page.getByTestId('server-file').filter({ hasText: CHAT_ICS });
  await icsCard.getByTestId('chat-file-menu').click();
  await expect(page.getByTestId('chat-file-open-in-app')).toHaveText('Open in Calendar');
  await page.getByTestId('chat-file-open-in-app').click();
  await importsInTheCalendar(page, CHAT_ICS, CHAT_ICS_TITLE);
});
