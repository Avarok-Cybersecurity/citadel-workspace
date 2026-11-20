/**
 * Account recovery, end to end against the stack: the 24-word phrase a new account is shown once
 * and must confirm, "Recover account" on the sign-in screen with that phrase, and the recovery
 * console setting a new password and landing signed in with it.
 *
 * SAME DEVICE, not a second one. A device here is an agent, and the stack runs exactly one
 * (`internal-service` in docker-compose.yml) that every browser context shares, so a second
 * context is the same device holding the same account. On a device that holds the account the
 * agent does not revoke anything (requests/recover_account.rs): the phrase only signs in to the
 * console, and the console says nothing about other devices. That is asserted below, so the
 * second-device path (every other device signed out, the console saying so) is not mistaken for
 * covered: it needs a second agent, and is covered by the agent's pq_account_recovery tests.
 *
 * The phrase step is answered by the suite's own helper (confirmRecoveryPhrase, which every
 * registration in the suite goes through: it reads the 24 words off the screen and types back the
 * three the check asks for); createAccount hands this spec the words it read. Copy, Download and
 * a refused check are the unit tests' and the polish harness's (RecoveryPhrasePanel).
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createAccount, disconnectViaTopBar, waitForAppReady, waitForWorkspaceLoaded } from '../lib/index.js';
import { signedInAs } from '../lib/signed-in-as.js';
import { config } from '../lib/config.js';

const USERNAME: string = `pw_recover_${Date.now()}`;
const NEW_PASSWORD: string = 'recovered42';
const PHRASE_WORDS: number = 24;

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
/** The phrase as the registration showed it, from the suite's helper. */
let phrase: string[] = [];

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
});

test('(a) registration shows the 24-word phrase once and lets the account in once three words are typed back', async () => {
  expect(await createAccount(page, USERNAME, { onRecoveryPhrase: (words: string[]): void => { phrase = words; } })).toBe(true);
  expect(phrase, 'the registration never showed a phrase').toHaveLength(PHRASE_WORDS);
  for (const word of phrase) expect(word, `"${word}" is not a lower-case word`).toMatch(/^[a-z]{3,8}$/);
  expect(new Set(phrase).size, 'the phrase repeats most of its words').toBeGreaterThan(PHRASE_WORDS / 2);
  expect(await waitForWorkspaceLoaded(page, 30_000)).toBe(true);
  expect(await signedInAs(page)).toBe(USERNAME);
});

test('(b) "Recover account" with the phrase opens the recovery console, not the workspace', async () => {
  expect(phrase).toHaveLength(PHRASE_WORDS);
  expect(await disconnectViaTopBar(page, USERNAME)).toBe(true);
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 30_000);
  await page.getByTestId('sign-in-button').click();
  await page.getByTestId('login-recover-account').click();

  const form = page.getByTestId('recover-account');
  await expect(form).toBeVisible();
  await page.locator('#recover-username').fill(USERNAME);
  await page.locator('#recover-server').fill(config.WORKSPACE_SERVER);

  // A word off the list is refused by name before anything is sent.
  const fifth = page.getByTestId('recover-phrase-word').nth(4);
  await fifth.fill('zzzzz');
  await fifth.blur();
  await expect(fifth).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('recover-submit').click();
  await expect(page.getByTestId('recover-error')).toBeVisible();
  await expect(page.getByTestId('recovery-console')).toHaveCount(0);

  // The whole phrase pasted into the first box fills all 24, as a paste from the saved file does.
  await page.getByTestId('recover-phrase-word').first().evaluate((cell: HTMLInputElement, text: string): void => {
    const data: DataTransfer = new DataTransfer();
    data.setData('text', text);
    cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, phrase.join(' '));
  const cells = page.getByTestId('recover-phrase-word');
  await expect.poll(() => cells.evaluateAll((all: Element[]) => all.map((c: Element) => (c as HTMLInputElement).value))).toEqual(phrase);
  await expect(fifth).not.toHaveAttribute('aria-invalid', 'true');

  await page.getByTestId('recover-submit').click();
  const consoleView = page.getByTestId('recovery-console');
  await expect(consoleView).toBeVisible({ timeout: 60_000 });
  await expect(consoleView).toHaveAttribute('data-view', 'welcome');
  expect(page.url(), 'a recovery session reached the workspace').not.toMatch(/\/(workspace|office)/);
  // The same device: nothing was revoked, so the console must not claim other devices were signed out.
  await expect(page.getByTestId('recovery-console-devices-signed-out')).toHaveCount(0);
});

test('(c) the console sets a new password and lands signed in with it', async () => {
  const consoleView = page.getByTestId('recovery-console');
  await page.getByTestId('recovery-console-begin').click();
  await expect(consoleView).toHaveAttribute('data-view', 'tasks');
  await page.getByTestId('recovery-task-password').click();
  await expect(consoleView).toHaveAttribute('data-view', 'password');

  await page.locator('#console-password').fill(NEW_PASSWORD);
  await page.locator('#console-password-again').fill(NEW_PASSWORD);
  await page.getByTestId('console-password-save').click();
  await expect(consoleView).toHaveAttribute('data-view', 'tasks', { timeout: 30_000 });

  await page.getByTestId('recovery-console-done').click();
  await expect(consoleView).toHaveAttribute('data-view', 'finish');
  await page.getByTestId('recovery-console-continue').click();

  await page.waitForURL(/\/(workspace|office)/, { timeout: 60_000 });
  expect(await waitForWorkspaceLoaded(page, 30_000)).toBe(true);
  expect(await signedInAs(page)).toBe(USERNAME);
  await expect(page.getByTestId('recovery-console')).toHaveCount(0);
});
