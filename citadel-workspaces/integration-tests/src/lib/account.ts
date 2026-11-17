/**
 * Account management operations
 */

import type { Page } from 'playwright';
import type { CreateAccountOptions } from './types.js';
import { config } from './config.js';
import { closeAnyModals, waitForWorkspaceLoaded } from './modals.js';
import { waitForRegistrationToSettle } from './post-registration.js';
import { takeScreenshot } from './screenshots.js';
import { clearBrowserStorage, waitForAppReady } from './browser.js';
import { isVisibleWithin } from './utils.js';

/**
 * Create a new user account
 */
export async function createAccount(page: Page, username: string, options: CreateAccountOptions = {}): Promise<boolean> {
  const {
    isFirstUser = false,
    password = config.DEFAULT_PASSWORD,
    uxTracker = null,
  } = options;

  console.log(`\n=== Creating account: ${username} ===`);

  // Use 'commit' instead of 'load' because WASM loading can take a long time.
  // On cold start, Vite dev server optimizes dependencies which can take 10-30s.
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60000 });

  // Wait for the React app to actually render (handles Vite cold start)
  await waitForAppReady(page, 60000);

  // CRITICAL: Clear all browser storage after navigation to avoid stale session/peer data
  // from previous test runs. This prevents P2PAutoConnect from trying to connect to
  // non-existent peers from old sessions.
  //
  // Never while another tab of this context is open: the storage is that tab's too (its tab
  // selection, kept sessions, peer requests). Clearing it signed every earlier tab out from under
  // itself; in a room chat each earlier member's node chat then had no account and refused to send
  // ("This tab has not finished signing in"). Read from the context, not asked of each caller:
  // the two-tab spec passed a flag for it, and the group helpers that open N tabs never did.
  const sharesContext: boolean = page.context().pages().some((other: Page): boolean => other !== page && !other.isClosed());
  if (!sharesContext) await clearBrowserStorage(page);

  // Reload the page to ensure the app starts fresh without stale state.
  // Second load should be fast since Vite deps are already optimized.
  await page.reload({ waitUntil: 'commit', timeout: 60000 });
  await waitForAppReady(page, 30000);

  // Click "Create Account" button
  // Use force:true to bypass Playwright's stability check. In multi-tab tests,
  // BroadcastChannel leader election can cause continuous re-renders that keep
  // the button "not stable" indefinitely.
  const joinBtn = page.getByTestId('create-account-button');
  if (await isVisibleWithin(joinBtn, 5000)) {
    await joinBtn.click({ force: true });
  }

  // Step 1: Fill workspace address (using role-based selector)
  const serverInput = page.getByRole('textbox', { name: 'Workspace Address' });
  if (await isVisibleWithin(serverInput, 5000)) {
    await serverInput.fill(config.WORKSPACE_SERVER);

    // By testid. The button reads "Next"; this asked for "NEXT" and matched
    // only because the CSS uppercases it, which means the check depended on a
    // text-transform. See round 247 for what that costs when the copy moves.
    await page.getByTestId('wizard-next').click();
  }

  // Step 2: Security Settings - just click NEXT
  const securityTitle = page.locator('text="Security Settings"');
  if (await isVisibleWithin(securityTitle, 3000)) {
    await page.getByTestId('wizard-next').click();
  }

  // Sonner renders a rejection as `<li data-sonner-toast data-type="error">` and
  // sets NO role="alert" — the selector this file shared with checkForErrors
  // matched nothing at all, in every spec in the suite.
  const errorToast = page
    .locator(
      '[data-sonner-toast][data-type="error"], ' +
        '[role="alert"]:has-text("error"), [role="alert"]:has-text("failed")',
    )
    .first();

  type Rejection = { kind: 'rejected'; detail: string } | { kind: 'no-error'; detail: string };
  let rejection: Promise<Rejection> = Promise.resolve({ kind: 'no-error', detail: '' });

  // Step 3: User Details form (Create Your Profile)
  const fullNameInput = page.getByRole('textbox', { name: 'Full Name' });
  if (await isVisibleWithin(fullNameInput, 5000)) {
    await fullNameInput.fill(username);

    const usernameInput = page.getByRole('textbox', { name: 'Username' });
    if (await usernameInput.isVisible()) {
      await usernameInput.fill(username);
    }

    const passwordInput = page.getByRole('textbox', { name: 'Profile Password', exact: true });
    const confirmPasswordInput = page.getByRole('textbox', { name: 'Confirm Profile Password' });

    if (await passwordInput.isVisible()) {
      await passwordInput.fill(password);
    }
    if (await confirmPasswordInput.isVisible()) {
      await confirmPasswordInput.fill(password);
    }

    // Diagnostics stay at their default (off). The Terms are put to the person only on an
    // Avarok-hosted server (a dialog at Join), never on the local stack these tests run against.

    // The profile step's submit, by testid rather than by the word on it.
    const submitBtn = page.getByTestId('join-submit');
    if (await submitBtn.isVisible()) {
      // Armed BEFORE the click. The toast lands ~2.5s after submit and Sonner
      // auto-dismisses it ~4s later, so any watcher started after the race
      // below is looking for something that has already gone. The text is
      // captured the instant it becomes visible for the same reason.
      // 15s, not 30: the toast lands ~2.5s after submit, so this is already 6x
      // the observed latency, and every extra second is a Playwright poll loop
      // running per context — three of them at once in the group-call specs.
      rejection = errorToast
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(async () => ({
          kind: 'rejected' as const,
          detail: (await errorToast.textContent().catch(() => null))?.trim() ?? 'unknown error',
        }))
        .catch(() => ({ kind: 'no-error' as const, detail: '' }));

      await submitBtn.click();
      // Registration is a server round trip, so this genuinely has to wait — but
      // for the OUTCOME, not for a fixed 8s. Exactly one of two things follows:
      // the Initialize Workspace modal (this is the first account on the server)
      // or navigation into the workspace. Racing them returns as soon as either
      // lands, and still fails loudly if neither does.
      await Promise.race([
        page.locator('input#masterPassword').waitFor({ state: 'visible', timeout: 30_000 }),
        page.waitForURL(/\/(workspace|office)/, { timeout: 30_000 }),
        // A refused registration produces NEITHER of the above, so without this
        // arm the helper sat out the full 30s and then another 45s downstream.
        rejection.then((r) => (r.kind === 'rejected' ? undefined : new Promise<never>(() => {}))),
      ]).catch(() => {
        // Neither arrived; waitForWorkspaceLoaded below reports the real failure
        // with more context than a timeout here would.
      });
    }
  }

  // Handle Initialize Workspace modal (only for first user)
  if (isFirstUser) {
    const passwordField = page.locator('input#masterPassword');
    // waitFor, NOT isVisible({ timeout }) — Playwright ignores that option, so
    // this was an immediate snapshot taken right after registration. A genuinely
    // first user whose modal had not rendered yet would silently skip
    // initialisation and end up a NON-ADMIN, which then surfaces much later as
    // "Permission denied: EditTreeStructure required" on the first create.
    // Every branch below logs. This block used to be silent, so a run that
    // ended on the landing page with a live session chip could not say whether
    // the modal never rendered, the submit button was missing, or the server
    // refused the password -- three different defects with one symptom, and
    // closeAnyModals() then pressed Cancel on whatever was left, discarding the
    // admin without a trace.
    const modalWait = Date.now();
    const modalAppeared = await passwordField
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (modalAppeared) {
      console.log(`  Initialize Workspace modal appeared after ${Date.now() - modalWait}ms`);
      await passwordField.fill(config.WORKSPACE_PASSWORD);

      const initBtn = page.getByTestId('init-modal-submit');
      if (await initBtn.isVisible()) {
        await initBtn.click();
        // Wait for the modal to actually close rather than a flat 5s — that is
        // the signal that the server accepted the initialisation.
        const closeWait = Date.now();
        const closed = await passwordField
          .waitFor({ state: 'hidden', timeout: 30_000 })
          .then(() => true)
          .catch(() => false);
        console.log(
          closed
            ? `  Initialize Workspace modal closed after ${Date.now() - closeWait}ms (server accepted)`
            : '  Initialize Workspace modal STILL OPEN after 30s — server did not accept the master password'
        );
      } else {
        console.log('  Initialize Workspace modal has no visible submit button (init-modal-submit)');
      }
    } else {
      console.log('  Initialize Workspace modal did not appear within 10s of registration');
    }
  }

  // The server can reject a registration outright — the SDK enforces a
  // credential contract (3-37 char username, 7-17 char password, no spaces)
  // and a duplicate username is refused. This used to return an unconditional
  // `true`, so every caller's `expect(await createAccount(...)).toBe(true)`
  // asserted a constant: a run whose registration was refused reported success
  // and then failed later somewhere unrelated, with the cause long scrolled off.
  //
  // The watcher for that rejection is armed before the submit click above, not
  // here: closeAnyModals presses Escape, which dismisses Sonner toasts, and the
  // 30s post-submit race outlives the toast entirely.

  await waitForRegistrationToSettle(page);

  await closeAnyModals(page);

  // Raced against the success signal so a working registration pays nothing.
  //
  // The rejection arm may only WIN when it is actually a rejection.
  //
  // `rejection` resolves to `{ kind: 'no-error' }` after 15 seconds whenever no
  // error toast appears -- which is the ordinary SUCCESSFUL case. Raced bare, it
  // therefore beat `waitForWorkspaceLoaded` on any machine where the workspace
  // takes longer than ~15s to load, `outcome.kind` came back `no-error`, and the
  // branch below reported "Workspace never loaded" for a workspace that loaded
  // moments later. `Promise.race` does not cancel the loser, so the log shows
  // both: the failure, and then "Workspace fully loaded" from the still-running
  // waiter.
  //
  // That is every integration job on a loaded CI runner, and no local run,
  // because locally the workspace loads in a second or two.
  //
  // The inner race above already does exactly this -- `r.kind === 'rejected' ?
  // undefined : new Promise(() => {})` -- and the reasoning was not carried the
  // seventy lines down to here.
  const outcome = await Promise.race([
    rejection.then((r) => (r.kind === 'rejected' ? r : new Promise<never>(() => {}))),
    waitForWorkspaceLoaded(page, 45000).then((ok) => ({
      kind: ok ? ('loaded' as const) : ('not-loaded' as const),
      detail: '',
    })),
  ]);

  if (outcome.kind === 'rejected') {
    if (uxTracker) {
      uxTracker.log('critical', 'functional', `Registration rejected for ${username}: ${outcome.detail}`);
    }
    await takeScreenshot(page, `${username}_registration_rejected`);
    console.log(`  Account ${username} was REJECTED: ${outcome.detail}`);
    return false;
  }

  if (outcome.kind !== 'loaded') {
    // Report it, do not warn past it.
    //
    // This logged the warning and then `return true`. The comment forty lines
    // up describes the same defect for the REJECTED case and says an
    // unconditional `true` made every caller's
    // `expect(await createAccount(...)).toBe(true)` an assertion on a constant.
    // The not-loaded case kept doing exactly that.
    //
    // It matters beyond the assertion. The four reconnection specs call this and
    // then begin P2P registration; if the invitee's workspace has not loaded,
    // the incoming `PeerRegisterNotification` is dropped on the agent (no
    // session in `server_connection_map` yet) or in the browser (no cid to
    // filter on yet), and NOTHING re-queries it — the badge simply never
    // appears. Saying "created" for a page that is not ready is what let those
    // specs start racing.
    //
    // The wait it failed is 45 seconds, so this is a broken workspace rather
    // than a slow one.
    if (uxTracker) {
      uxTracker.log('critical', 'functional', `Workspace never loaded for ${username}`);
    }
    await takeScreenshot(page, `${username}_workspace_never_loaded`);
    console.log(`  Account ${username} registered but its workspace never loaded`);
    return false;
  }

  await takeScreenshot(page, `${username}_created`);
  console.log(`  Account ${username} created`);
  return true;
}
