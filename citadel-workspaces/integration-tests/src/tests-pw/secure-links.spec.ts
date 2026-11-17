/**
 * A one-time secure link, end to end, with three people in one browser.
 *
 * Alice makes a one-time link to a folder for Bob through the share dialog. Carol, who is not
 * named, opens it and is told "This link isn't available to you", lands in the workspace, and
 * does not use the link up. Bob opens it and lands exactly on the folder's deep link. Bob opens
 * it again and it is gone. Alice's Security tab lists the link until Bob uses it, then not.
 *
 * Accounts are made one after another in a single tab first, because `createAccount` clears the
 * browser's storage (sessions live in the agent and survive it). Each person then gets a tab of
 * the same context, and switches to their session from the landing page's session chips.
 */
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  closeAnyModals,
  config,
  createAccount,
  createBrowser,
  waitForAppReady,
  waitForWorkspaceLoaded,
} from '../lib/index.js';
import { createFolder, openFileManagerFromSidebar, openItemMenu } from '../lib/file-manager.js';
import { pressAccountMenuItem } from '../lib/account-menu.js';

const STAMP: string = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const ALICE: string = `pw_link_alice_${STAMP}`;
const BOB: string = `pw_link_bob_${STAMP}`;
const CAROL: string = `pw_link_carol_${STAMP}`;
const PASSWORD: string = config.DEFAULT_PASSWORD;
const FOLDER: string = `linked-${STAMP}`;
const UNAVAILABLE: string = "This link isn't available to you";

let browser: Browser;
let context: BrowserContext;
let alice: Page;
let bob: Page;
let carol: Page;
/** The folder's in-app deep link, read from the dialog's plain link. */
let target: URL;
/** The secure link, shown once. */
let secureLink: string;

/** A fresh tab of the shared context, signed in as `username` through its session chip. */
async function tabFor(username: string): Promise<Page> {
  const page: Page = await context.newPage();
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);
  const chip: Locator = page.getByTestId(`session-button-${username}`);
  await expect(chip, `${username}'s session chip`).toBeVisible({ timeout: 30_000 });
  await chip.click();
  expect(await waitForWorkspaceLoaded(page, 60_000), `${username}'s workspace loads`).toBe(true);
  await closeAnyModals(page);
  return page;
}

/**
 * Open the secure link in `page` as `username` would: the landing page asks them to sign in,
 * and their existing session opens it. If the tab goes on to the workspace by itself, the
 * workspace loader opens it instead; either way the link is resolved by this tab's session.
 */
async function openLink(page: Page, username: string): Promise<void> {
  await page.bringToFront();
  await page.goto(secureLink, { waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);
  const usernameField: Locator = page.locator('#username');
  await expect
    .poll(async (): Promise<boolean> => (await usernameField.isVisible()) || new URL(page.url()).pathname !== '/', { timeout: 60_000 })
    .toBe(true);
  if (await usernameField.isVisible()) {
    await usernameField.fill(username);
    await page.locator('#password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
  }
}

/** The unavailable notice (a Sonner toast, which has no role=alert), then the workspace itself. */
async function expectUnavailable(page: Page): Promise<void> {
  await expect(page.locator('[data-sonner-toast]', { hasText: UNAVAILABLE }).first()).toBeVisible({ timeout: 60_000 });
  await expect.poll((): string => new URL(page.url()).pathname, { timeout: 30_000 }).toBe('/workspace');
  expect(new URL(page.url()).searchParams.get('path'), 'not the linked folder').toBeNull();
}

/** Alice's Security tab, with her list of links loaded (its quota meter is drawn with the list). */
async function openSecurity(): Promise<Locator> {
  await alice.bringToFront();
  await pressAccountMenuItem(alice, 'account-menu-settings');
  await alice.getByTestId('settings-tab-security').click();
  const section: Locator = alice.getByTestId('secure-links-section');
  await expect(section.getByTestId('security-links-quota')).toBeVisible({ timeout: 30_000 });
  return section;
}

async function closeSecurity(): Promise<void> {
  await alice.keyboard.press('Escape');
  await expect(alice.getByTestId('secure-links-section')).toHaveCount(0, { timeout: 10_000 });
}

function linkRow(section: Locator): Locator {
  return section.getByTestId('secure-link-row').filter({ hasText: FOLDER });
}

test.describe.serial('Secure links', () => {
  test.beforeAll(async () => {
    test.setTimeout(600_000);
    ({ browser, context } = await createBrowser());
    const first: Page = await context.newPage();
    for (const username of [BOB, CAROL, ALICE]) {
      expect(await createAccount(first, username, { isFirstUser: false, password: PASSWORD, uxTracker: null }), `register ${username}`).toBe(true);
      expect(await waitForWorkspaceLoaded(first, 60_000), `${username}'s workspace loads`).toBe(true);
    }
    // The tab Alice registered in last is hers.
    alice = first;
    await closeAnyModals(alice);
    bob = await tabFor(BOB);
    carol = await tabFor(CAROL);
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test('Alice makes a one-time link to a folder for Bob', async () => {
    test.setTimeout(240_000);
    await alice.bringToFront();
    expect(await openFileManagerFromSidebar(alice), 'the file manager opens').toBe(true);
    expect(await createFolder(alice, FOLDER), 'the folder is made').toBe(true);
    const menu: Locator | null = await openItemMenu(alice, FOLDER);
    expect(menu, 'the folder has a menu').not.toBeNull();
    await expect(menu!.getByTestId('vfs-share')).toHaveText('Share folder');
    await menu!.getByTestId('vfs-share').click();

    const dialog: Locator = alice.getByTestId('share-link-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const plain: Locator = dialog.getByRole('textbox', { name: `Link to ${FOLDER}` });
    await expect(plain).toHaveValue(/\/workspace\?/, { timeout: 10_000 });
    target = new URL(await plain.inputValue());

    await dialog.getByTestId('share-mode-secure').click();
    const panel: Locator = dialog.getByTestId('share-secure-panel');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    // A server folder is for everyone by default; this one is for Bob alone.
    const chips: Locator = panel.getByTestId('share-grant-chip');
    await expect(chips).toHaveCount(1);
    await expect(chips).toHaveText('Everyone in the workspace');
    await chips.getByTestId('share-grant-remove').click();
    await expect(chips).toHaveCount(0);
    // The member list loads after the dialog opens; retry until Bob is offered. Escape only
    // closes a list left open by a failed try, never the dialog.
    const options: Locator = alice.getByRole('listbox');
    await expect(async () => {
      if (await options.isVisible()) await alice.keyboard.press('Escape');
      await panel.getByTestId('share-add-member').click({ timeout: 3_000 });
      await alice.getByTestId(`share-member-option-${BOB}`).click({ timeout: 3_000 });
    }).toPass({ timeout: 60_000 });
    await expect(chips).toHaveCount(1);
    await expect(chips).toHaveText(BOB);

    const oneTime: Locator = panel.getByTestId('share-one-time');
    await oneTime.click();
    await expect(oneTime).toHaveAttribute('aria-checked', 'true');
    await panel.getByTestId('share-create-secure').click();

    const created: Locator = dialog.getByTestId('share-secure-created');
    await expect(created).toBeVisible({ timeout: 30_000 });
    const field: Locator = created.getByRole('textbox', { name: `Secure link to ${FOLDER}` });
    await expect(field).toHaveValue(/\/\?redirect=[A-Za-z0-9_-]{43}&server=/);
    secureLink = await field.inputValue();
    // The address says nothing about where it points.
    expect(secureLink).not.toContain(FOLDER);
    await alice.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  });

  test("Alice's Security tab lists the link before it is used", async () => {
    const section: Locator = await openSecurity();
    await expect(linkRow(section)).toHaveCount(1, { timeout: 30_000 });
    await expect(linkRow(section).getByTestId('secure-link-expiry')).toContainText('One-time');
    await expect(linkRow(section).getByTestId('secure-link-expiry')).toContainText('Not used yet');
    await closeSecurity();
  });

  test('Carol, not named, is told it is unavailable and lands in the workspace', async () => {
    test.setTimeout(180_000);
    await openLink(carol, CAROL);
    await expectUnavailable(carol);
  });

  test("Carol's attempt did not use the link up", async () => {
    const section: Locator = await openSecurity();
    await expect(linkRow(section)).toHaveCount(1, { timeout: 30_000 });
    await expect(linkRow(section).getByTestId('secure-link-expiry')).toContainText('Not used yet');
    await closeSecurity();
  });

  test('Bob opens it and lands exactly on the folder', async () => {
    test.setTimeout(180_000);
    await openLink(bob, BOB);
    await expect.poll((): string => new URL(bob.url()).pathname, { timeout: 60_000 }).toBe(target.pathname);
    const here: URLSearchParams = new URL(bob.url()).searchParams;
    for (const [key, value] of target.searchParams) expect(here.get(key), `the link's ${key}`).toBe(value);
    await expect(bob.getByRole('group', { name: 'Storage' })).toBeVisible({ timeout: 30_000 });
  });

  test("Alice's Security tab no longer lists the used link", async () => {
    const section: Locator = await openSecurity();
    // Presence first: the empty list is drawn, so the row's absence below is a real reading.
    await expect(section.getByTestId('security-links-empty')).toBeVisible({ timeout: 30_000 });
    await expect(linkRow(section)).toHaveCount(0);
    await closeSecurity();
  });

  test('Bob opens it again and it is unavailable', async () => {
    test.setTimeout(180_000);
    await openLink(bob, BOB);
    await expectUnavailable(bob);
  });
});
