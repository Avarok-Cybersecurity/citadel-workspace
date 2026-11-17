/**
 * A file shared in a node channel is kept on the workspace server and reaches the channel's
 * members, under the name it was shared with, byte for byte, and nobody else.
 *
 * The admin shares a file into a fresh office's chat through the channel's file picker; the strip
 * says when the server has it. A member, in another browser, sees its card in the transcript and
 * downloads it: the download is named as the file was (the card saves under the sender's name,
 * sanitised, and this name has nothing to sanitise) and holds the same bytes. A third account,
 * removed from the workspace by the admin, finds neither the office nor the card.
 *
 * Only what a person sees is asserted; nothing is reached through a test hook. Whether the server
 * refuses a direct read by a non-member is the kernel's test (chat_attachments), not this one's.
 */
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { adminMemberTest, createUserSession, type UserSession } from '../fixtures/multi-user.fixture.js';
import { activateAdminTab, adminDialog, createOffice, navigateToOffice, openAdminPanel, revealNode, switchToChatTab, treeRow } from '../lib/index.js';

const stamp: number = Date.now();
const OFFICE: string = `Files ${stamp}`;
const NAME: string = `boiler-readings-${stamp}.csv`;
/** Three chunks of the server's 256 KiB, the last one short, so the upload is a real chunked one. */
const BYTES: Buffer = Buffer.from(Array.from({ length: 256 * 1024 * 2 + 777 }, (_: unknown, i: number): number => (i * 31 + 7) % 256));

/** The card of the shared file in `page`'s open channel. */
const card = (page: Page): Locator => page.getByTestId('server-file').filter({ hasText: NAME });

async function openChannel(page: Page, username: string): Promise<void> {
  expect(await navigateToOffice(page, username, OFFICE), `${username} should reach "${OFFICE}"`).toBe(true);
  expect(await switchToChatTab(page, username), `${username} should open its chat`).toBe(true);
  await expect(page.getByTestId('group-message-input')).toBeVisible({ timeout: 30_000 });
}

adminMemberTest('a channel file reaches a member under its own name, and not a removed account', async ({ admin, member }) => {
  adminMemberTest.setTimeout(420_000);
  const outsider: UserSession = await createUserSession('outsider');
  try {
    expect(await createOffice(admin.page, admin.username, OFFICE), `the admin should create "${OFFICE}" with its chat on`).toBe(true);
    await openChannel(admin.page, admin.username);
    await expect(admin.page.getByTestId('attach-destination')).toHaveText("Stored on the workspace server, readable by this channel's members");

    await admin.page.getByTestId('group-file-input').setInputFiles({ name: NAME, mimeType: 'text/csv', buffer: BYTES });
    // The strip ends in one of two states; waiting on either, and failing on a refusal with the
    // server's own words, says which rather than timing out on a share that will never come.
    const strip: Locator = admin.page.getByTestId('server-upload');
    await expect(strip.and(admin.page.locator('[data-upload-state="shared"], [data-upload-state="refused"]'))).toBeVisible({ timeout: 120_000 });
    if ((await strip.getAttribute('data-upload-state')) === 'refused') throw new Error(`the server refused the upload: ${await strip.innerText()}`);
    await expect(strip).toContainText(`Shared ${NAME} with the channel`);
    await expect(card(admin.page)).toBeVisible({ timeout: 30_000 });

    await openChannel(member.page, member.username);
    await expect(card(member.page)).toBeVisible({ timeout: 60_000 });
    await expect(card(member.page)).toContainText('on the workspace server');
    // Awaited together with the click that starts it, so a failed click is the error raised.
    const [download]: [Download, void] = await Promise.all([
      member.page.waitForEvent('download', { timeout: 120_000 }),
      card(member.page).getByTestId('server-file-download').click(),
    ]);
    expect(download.suggestedFilename()).toBe(NAME);
    const path: string | null = await download.path();
    expect(path, 'the download should finish').not.toBeNull();
    expect(readFileSync(path!).equals(BYTES), 'the downloaded bytes should be the shared file\'s').toBe(true);

    // The control for what follows: before removal the outsider reaches the office like anyone.
    expect(await revealNode(outsider.page, OFFICE, 60_000), `"${OFFICE}" should be reachable by the outsider while a member`).not.toBeNull();
    // Removed from the workspace, the outsider holds no permission anywhere in it.
    expect(await openAdminPanel(admin.page), 'the admin should open Admin Settings').toBe(true);
    expect(await activateAdminTab(admin.page, 'members'), 'the Members tab should render').toBe(true);
    await adminDialog(admin.page).getByTestId(`member-remove-${outsider.username}`).click();
    const confirm: Locator = admin.page.getByRole('alertdialog').getByTestId('confirm-dialog-confirm');
    await expect(confirm).toHaveText('Remove');
    await confirm.click();
    await expect(adminDialog(admin.page).getByTestId(`member-remove-${outsider.username}`)).toHaveCount(0, { timeout: 30_000 });
    await admin.page.keyboard.press('Escape');

    // Reloaded on the office it had open. The kernel refuses a removed account the workspace record
    // and the node list, so the app never opens: the page says the account is not a member, in place
    // of the workspace. (It used to wait for the record for ever, "taking longer than expected" --
    // run 43918454602.) The refusal is asserted as what the page shows, then the office's absence.
    await outsider.page.reload();
    await expect(outsider.page.getByTestId('workspace-refused'), 'a removed account should be told it is not a member').toBeVisible({ timeout: 60_000 });
    await expect(outsider.page.getByTestId('workspace-refused')).toContainText('not a member of this workspace');
    await expect(treeRow(outsider.page, OFFICE)).toHaveCount(0);
    await expect(card(outsider.page)).toHaveCount(0);
    // The second control: the member, still in the workspace, still reaches the office after a reload.
    await member.page.reload();
    expect(await revealNode(member.page, OFFICE, 60_000), `"${OFFICE}" should still be reachable by the member`).not.toBeNull();
  } finally {
    await outsider.browser.close();
  }
});
