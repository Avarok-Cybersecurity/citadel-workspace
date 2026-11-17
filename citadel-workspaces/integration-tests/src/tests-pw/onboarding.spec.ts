/**
 * The production first-run onboarding, and the promise that it costs the suite
 * nothing.
 *
 * `isOnboardingEnabled` (src/lib/debug-config.ts) is OFF in development. That
 * is the whole reason this feature is affordable: the suite creates an account
 * for nearly every spec at 9 UI interactions each -- 11 for the first user --
 * and a dialog on top of that would be clicked through roughly 90 times per
 * run to assert nothing.
 *
 * So the first test here is not about onboarding at all. It asserts the
 * ABSENCE, because a gate that quietly turned on would slow every other spec
 * and nothing else would notice; the suite would just get more expensive.
 *
 * The rest opt in with `?onboarding=1`, which is how production behaviour is
 * exercised without a production build. These run entirely client-side -- no
 * account is registered -- so they neither contend for the shared backend nor
 * leave state behind.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from '../lib/index.js';
import { config } from '../lib/config.js';

/**
 * The key the app writes when it decides not to ask for the master password.
 *
 * DERIVED from the module that declares it, never retyped. A spec holding its
 * own copy is a second source for one fact: rename the constant and this spec
 * keeps asserting on a key nothing writes any more, which reads as "the member
 * path was not suppressed" — a failure pointing at the wrong thing entirely —
 * or, in the absence assertions, as a pass.
 */
const OWNER: string = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/lib/workspace-init-prompt.ts',
);
const SUPPRESSED_KEY: string = ((): string => {
  const declared: RegExpMatchArray | null = readFileSync(OWNER, 'utf8').match(
    /INIT_PROMPT_SUPPRESSED_KEY: string = '([^']+)'/,
  );
  if (!declared) {
    throw new Error(
      `Could not read INIT_PROMPT_SUPPRESSED_KEY from ${OWNER}. Failing loudly rather ` +
        'than guessing a key: a wrong key makes every assertion below meaningless.',
    );
  }
  return declared[1];
})();

/** What the page has stored under that key, if anything. */
async function suppressed(page: Page): Promise<string | null> {
  return page.evaluate((key: string): string | null => sessionStorage.getItem(key), SUPPRESSED_KEY);
}

async function openLanding(page: Page, query: string = ''): Promise<void> {
  await page.goto(`${config.BASE_URL}${query}`, { waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);
}

async function clickCreateAccount(page: Page): Promise<void> {
  const btn = page.getByTestId('create-account-button');
  await btn.waitFor({ state: 'visible', timeout: 30_000 });
  await btn.click({ force: true });
}

test.describe('First-run onboarding', () => {
  test('is absent in the environment the suite runs in', async ({ page }) => {
    await openLanding(page);
    await clickCreateAccount(page);

    // Straight to the wizard. If this ever fails, every other spec in the
    // suite just became two interactions more expensive.
    await expect(
      page.getByTestId('server-address-input'),
      'dev must go straight to the wizard — onboarding is production-only',
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('onboarding-intent')).toHaveCount(0);
  });

  test('a new administrator is told about the master password before the wizard', async ({ page }) => {
    await openLanding(page, '?onboarding=1');
    await clickCreateAccount(page);

    const dialog = page.getByTestId('onboarding-intent');
    await expect(dialog).toBeVisible({ timeout: 30_000 });

    // The defect this exists to fix: WORKSPACE_MASTER_PASSWORD was first named
    // in a modal shown AFTER the account was created. Assert it is named here,
    // on the administrator's path, before anything is typed.
    const adminChoice = page.getByTestId('onboarding-intent-admin');
    await expect(adminChoice).toBeVisible();
    await expect(
      adminChoice,
      'the administrator path must name the master password before the wizard',
    ).toContainText(/master password/i);

    await adminChoice.click();

    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByTestId('server-address-input'),
      'choosing a path must not change the wizard that follows',
    ).toBeVisible({ timeout: 30_000 });
  });

  test('a new member is told they do NOT need the master password', async ({ page }) => {
    await openLanding(page, '?onboarding=1');
    await clickCreateAccount(page);

    const memberChoice = page.getByTestId('onboarding-intent-member');
    await expect(memberChoice).toBeVisible({ timeout: 30_000 });

    // A member who arrives before anyone has initialised is shown the
    // initialisation modal asking for a secret they cannot obtain. Saying so
    // here is the difference between a confusing prompt and an expected one.
    await expect(
      memberChoice,
      'the member path must say the master password is not theirs to supply',
    ).toContainText(/do not need the master password/i);

    await memberChoice.click();
    await expect(page.getByTestId('onboarding-intent')).toHaveCount(0);
    await expect(page.getByTestId('server-address-input')).toBeVisible({
      timeout: 30_000,
    });
  });

  test('skipping proceeds to the same wizard', async ({ page }) => {
    await openLanding(page, '?onboarding=1');
    await clickCreateAccount(page);

    await page.getByTestId('onboarding-intent-skip').click();
    await expect(page.getByTestId('onboarding-intent')).toHaveCount(0);
    await expect(page.getByTestId('server-address-input')).toBeVisible({
      timeout: 30_000,
    });
  });

  // What the answer DOES, not just what the dialog says.
  //
  // The unit tests call `resolve('member')` directly, so they cannot see which
  // BUTTON passes which value: swap the two `onChoose` arguments and every unit
  // test stays green while the admin is silently spared the prompt and the
  // member is handed it. Only a real click through the real DOM discriminates,
  // which is why these three live here.
  //
  // Still no account is registered — the answer is recorded client-side, before
  // the wizard runs — so the promise at the top of this file holds.
  test('choosing "joining" stops the master-password prompt for this tab', async ({ page }) => {
    await openLanding(page, '?onboarding=1');
    await clickCreateAccount(page);
    await expect(page.getByTestId('onboarding-intent')).toBeVisible({ timeout: 30_000 });

    // The paired control for the two absence assertions below: this proves the
    // key is one the app really writes. Without it, a renamed or misspelled key
    // makes `toBeNull()` true forever and all three tests pass over a feature
    // that does nothing.
    expect(await suppressed(page), 'nothing is decided until the dialog is answered').toBeNull();

    await page.getByTestId('onboarding-intent-member').click();

    expect(
      await suppressed(page),
      'a member said they do not hold the master password; they must not be asked for it',
    ).toBe('true');
  });

  test('choosing "setting up" leaves the prompt in place', async ({ page }) => {
    await openLanding(page, '?onboarding=1');
    await clickCreateAccount(page);
    await page.getByTestId('onboarding-intent-admin').click();

    expect(
      await suppressed(page),
      'the administrator is the one person the prompt is for',
    ).toBeNull();
  });

  test('skipping decides nothing', async ({ page }) => {
    await openLanding(page, '?onboarding=1');
    await clickCreateAccount(page);
    await page.getByTestId('onboarding-intent-skip').click();

    expect(
      await suppressed(page),
      'saying nothing is not saying "I am joining"',
    ).toBeNull();
  });

  // The off-switch is what lets a production Playwright run build its fixture
  // accounts cheaply and opt in only where onboarding is the subject. Untested,
  // a production suite would silently pay for the dialog on every setup account.
  test('?onboarding=0 suppresses it even where it would otherwise show', async ({ page }) => {
    await openLanding(page, '?onboarding=1');
    await clickCreateAccount(page);
    await expect(page.getByTestId('onboarding-intent')).toBeVisible({ timeout: 30_000 });

    await openLanding(page, '?onboarding=0');
    await clickCreateAccount(page);
    await expect(
      page.getByTestId('onboarding-intent'),
      'the explicit off-switch must win',
    ).toHaveCount(0);
    await expect(page.getByTestId('server-address-input')).toBeVisible({
      timeout: 30_000,
    });
  });
});

/**
 * The workspace address a hosted deployment publishes.
 *
 * In production the hosting nginx fills `<meta name="citadel-default-server">`
 * from DEFAULT_WORKSPACE_SERVER. The dev server this suite runs against ships
 * that meta EMPTY, which is correct — so the injection is simulated here with
 * an init script, exactly the value nginx would write, before the app boots.
 *
 * What this covers that the unit tests do not: that the value survives the real
 * React render and reaches the rendered input. The unit test asserts the reader
 * and, separately, that ServerConnect's initialiser mentions it — neither can
 * see a value that is read, passed, and then overwritten on mount.
 *
 * The meta NAME is derived from the module that declares it, for the same
 * reason as OWNER above: a spec holding its own copy of a key keeps asserting
 * on something nothing writes any more.
 */
const DEFAULT_SERVER_OWNER: string = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/lib/default-workspace-server.ts',
);

function metaNameFromSource(): string {
  const source: string = readFileSync(DEFAULT_SERVER_OWNER, 'utf8');
  const m: RegExpMatchArray | null = source.match(/DEFAULT_SERVER_META: string = '([^']+)'/);
  if (!m) throw new Error(`Could not read DEFAULT_SERVER_META from ${DEFAULT_SERVER_OWNER}`);
  return m[1];
}

test.describe('a deployment that publishes its workspace address', () => {
  const PUBLISHED: string = 'citadel.example.com:12400';

  async function openWizardWithMeta(page: Page, content: string): Promise<void> {
    const metaName: string = metaNameFromSource();
    await openLanding(page, '?onboarding=1');

    // Set the tag AFTER the document exists, and BEFORE ServerConnect mounts.
    //
    // Not `addInitScript`: that runs before the HTML is parsed, so the meta
    // index.html ships is not there yet, and a script that "sets the existing
    // tag" silently creates a second one instead. The reader uses
    // querySelector, which returns the FIRST match -- the empty one -- so the
    // field stayed blank on every retry.
    //
    // Not appended either, for the same reason. nginx rewrites the content
    // attribute of the single tag `index.html` ships (`sub_filter`), so the
    // production page has exactly one. This does what nginx does.
    //
    // Timing is safe: ServerConnect is not mounted until Create Account is
    // clicked, which is the next line.
    await page.evaluate(
      ({ name, value }: { name: string; value: string }): void => {
        const existing: HTMLMetaElement | null = document.querySelector(`meta[name="${name}"]`);
        if (!existing) throw new Error(`index.html no longer ships <meta name="${name}">`);
        existing.setAttribute('content', value);
      },
      { name: metaName, value: content },
    );

    await clickCreateAccount(page);
    await page.getByTestId('onboarding-intent-member').click({ timeout: 30_000 });
  }

  test('pre-fills the address so a newcomer is not asked for one nobody told them', async ({ page }) => {
    await openWizardWithMeta(page, PUBLISHED);
    await expect(
      page.getByTestId('server-address-input'),
      'the published address must reach the rendered field',
    ).toHaveValue(PUBLISHED, { timeout: 30_000 });
  });

  test('leaves it editable — a pre-fill, not a lock', async ({ page }) => {
    // Reaching somebody else's server from this page is legitimate, so the
    // field must still accept typing. A read-only pre-fill would strand anyone
    // whose workspace is not the one this deployment happens to serve.
    await openWizardWithMeta(page, PUBLISHED);
    const field = page.getByTestId('server-address-input');
    await expect(field).toHaveValue(PUBLISHED, { timeout: 30_000 });
    await field.fill('elsewhere.example.org:12500');
    await expect(field).toHaveValue('elsewhere.example.org:12500');
  });

  test('asks, as before, when the deployment published nothing', async ({ page }) => {
    // The control. Without it, a field that pre-filled unconditionally — from a
    // hard-coded constant, say — would satisfy both tests above.
    await openWizardWithMeta(page, '');
    await expect(
      page.getByTestId('server-address-input'),
      'an unpublished address must leave the field empty',
    ).toHaveValue('', { timeout: 30_000 });
  });
});
