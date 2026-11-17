import type { Page } from 'playwright';

/**
 * Wait for the app to finish leaving the registration wizard.
 *
 * After the server accepts registration (and, for the first user,
 * initialisation) the wizard stays on its Profile step while Landing runs
 * postAuthSetup and only then navigates. And the URL changing is not the end
 * of it: the workspace routes are lazy, so React keeps the previous screen --
 * wizard included -- on screen until the chunk loads. Measured on the dev
 * server: the "Create your profile" overlay was still 1280x720 at opacity 1
 * some 800ms after the URL read /workspace.
 *
 * Sweeping modals inside either window presses Escape on the wizard, which
 * is "back" (Profile, Security, Server), then clicks its own Cancel, and the
 * account just created ends on the landing page with a live session chip and
 * no workspace. A slow CI runner happened to navigate first; a fast local
 * stack never did. So: wait for both, on a budget, and log each gap. A
 * refused registration never navigates; the caller's rejection race reports
 * that, so this must not throw.
 */
export async function waitForRegistrationToSettle(page: Page): Promise<void> {
  const navWait = Date.now();
  const navigated = await walkPostRegistrationSteps(page);
  if (!navigated) {
    console.log('  Did not enter the workspace within 30s of registration');
    return;
  }
  console.log(`  Entered the workspace ${Date.now() - navWait}ms after registration`);

  const overlayWait = Date.now();
  const wizard = page.locator('[aria-label="Create your profile"]');
  const gone = await wizard
    .waitFor({ state: 'detached', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  console.log(
    gone
      ? `  Registration wizard left the screen ${Date.now() - overlayWait}ms after navigation`
      : '  Registration wizard STILL ON SCREEN 15s after navigation'
  );
}

const STEP_BUDGET_MS = 30_000;

/**
 * A server with post-quantum sign-in issues recovery codes, and the app then
 * holds the new account on "Secure your account" -- an optional security key,
 * then the codes -- and opens the workspace only once both are answered. The
 * Escape sweep does not answer them: it closed the card and left the wizard
 * behind it, so every account ended on the landing page. Answer each step as
 * a person would, on one shared budget, until the workspace route arrives.
 * Returns false if it never does.
 */
async function walkPostRegistrationSteps(page: Page): Promise<boolean> {
  const deadline = Date.now() + STEP_BUDGET_MS;
  const entered = page
    .waitForURL(/\/(workspace|office)/, { timeout: STEP_BUDGET_MS })
    .then(() => true)
    .catch(() => false);
  const card = page.getByTestId('post-registration');
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return entered;
    const next = await Promise.race([
      entered.then((ok) => (ok ? 'entered' : 'timeout')),
      card.waitFor({ state: 'visible', timeout: remaining }).then(() => 'card', () => 'timeout'),
    ]);
    if (next !== 'card') return next === 'entered';
    await answerPostRegistrationStep(page);
  }
}

async function answerPostRegistrationStep(page: Page): Promise<void> {
  const skipKey = page.getByTestId('add-security-key-skip');
  const codes = page.getByTestId('recovery-codes');
  const finish = page.getByTestId('finish-sign-in-continue');
  const step = await Promise.race([
    skipKey.waitFor({ state: 'visible' }).then(() => 'key' as const),
    codes.waitFor({ state: 'visible' }).then(() => 'codes' as const),
    finish.waitFor({ state: 'visible' }).then(() => 'sign-in' as const),
  ]);
  console.log(`  Post-registration step: ${step}`);
  if (step === 'key') {
    await skipKey.click();
    await skipKey.waitFor({ state: 'detached' });
  } else if (step === 'codes') {
    await page.getByTestId('recovery-codes-saved').check();
    await page.getByTestId('recovery-codes-done').click();
    await codes.waitFor({ state: 'detached' });
  } else {
    await finish.click();
    await finish.waitFor({ state: 'detached' });
  }
}
