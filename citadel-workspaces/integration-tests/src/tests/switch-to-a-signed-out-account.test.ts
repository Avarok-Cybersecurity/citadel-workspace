/**
 * The owner's report, live: clicking another account in the top bar's switcher said
 * "Session 14197768845630597388 not found".
 *
 * Reproduces it the way it happens: alice and bob are signed in in one browser, so
 * this browser saves both accounts; bob is then signed out from ANOTHER browser on the
 * same agent, which leaves this browser's saved record of him behind. The switcher in
 * alice's tab must show bob as signed out, and a click must open his sign-in with the
 * username filled and a reason in words -- never the agent's raw refusal -- and the
 * password must bring him back.
 *
 * Unit and component tests cover the decision (the-top-bar-signs-in-a-signed-out-account);
 * this needs the agent's real GetSessions answer after a sign-out from elsewhere.
 */
import {
  sleep, createBrowser, createAccount, takeScreenshot, setupConsoleCapture, waitForWorkspaceLoaded,
  closeAnyModals, disconnectViaNavbar, TestHarness, runTestMain, isVisibleWithin,
} from '../lib/index.js';
import { config } from '../lib/config.js';

const stamp: number = Date.now();
const ALICE: string = `swalice_${stamp}`;
const BOB: string = `swbob_${stamp}`;
const PASSWORD: string = config.DEFAULT_PASSWORD;
const RAW_REFUSAL: RegExp = /Session \d+ not found|is not claimable/;

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Switch To A Signed-Out Account',
    reportFileName: 'SWITCH_SIGNED_OUT_TEST_REPORT.json',
    metadata: { alice: ALICE, bob: BOB },
    restartBackend: true,
  });
  const here = await createBrowser();
  const elsewhere = await createBrowser();
  const results = { accountsCreated: false, signedOutElsewhere: false, rowSaysSignedOut: false, signInPrefilled: false, noRawRefusal: false, signedBackIn: false };

  try {
    const alice = await here.context.newPage();
    const bob = await here.context.newPage();
    setupConsoleCapture(alice, 'Alice', ['error', 'Session', 'Claim']);
    results.accountsCreated = (await createAccount(alice, ALICE, { isFirstUser: true, password: PASSWORD, uxTracker: harness.uxTracker }))
      && (await createAccount(bob, BOB, { password: PASSWORD, uxTracker: harness.uxTracker }));
    if (!results.accountsCreated) throw new Error('Account creation failed');
    await bob.close();

    const other = await elsewhere.context.newPage();
    results.signedOutElsewhere = await disconnectViaNavbar(other, BOB, harness.uxTracker);
    if (!results.signedOutElsewhere) throw new Error(`${BOB} could not be signed out from the other browser`);

    await alice.bringToFront();
    await closeAnyModals(alice);
    await waitForWorkspaceLoaded(alice, 30_000);
    await alice.getByTestId('workspace-switcher').click();
    // bob is the only account this browser saved that the agent no longer holds.
    const row = alice.getByTestId('switcher-account-signed-out');
    results.rowSaysSignedOut = await isVisibleWithin(row, 15_000) && (await row.count()) === 1
      && (await row.innerText()).includes(BOB) && /Signed out/.test(await row.innerText());
    await takeScreenshot(alice, '01_switcher_signed_out');
    if (!results.rowSaysSignedOut) throw new Error(`${BOB}'s row does not say he is signed out`);

    await row.click();
    const notice = alice.getByTestId('login-notice');
    // Scoped to bob's server: the form says which, and offers nothing from another.
    results.signInPrefilled = await isVisibleWithin(notice, 15_000)
      && /Signing in to /.test(await alice.getByTestId('login-scope').innerText())
      && (await alice.locator('#username').inputValue()) === BOB
      && (await alice.locator('#password').inputValue()) === '';
    await takeScreenshot(alice, '02_sign_in_prefilled');
    await sleep(1000);
    const toasts: string = (await alice.locator('[data-sonner-toast]').allInnerTexts()).join('\n');
    results.noRawRefusal = !RAW_REFUSAL.test(toasts) && !RAW_REFUSAL.test(await notice.innerText());

    await alice.locator('#password').fill(PASSWORD);
    await alice.getByTestId('login-submit').click();
    results.signedBackIn = await waitForWorkspaceLoaded(alice, 60_000)
      && (await alice.getByTestId('workspace-switcher-user').innerText()).includes(BOB);
    await takeScreenshot(alice, '03_signed_back_in');

    const passed: boolean = Object.values(results).every(Boolean);
    for (const [name, ok] of Object.entries(results)) console.log(`  ${name.padEnd(20)} ${ok ? 'PASS' : 'FAIL'}`);
    harness.finalize(passed, results);
    return passed;
  } finally {
    await elsewhere.browser.close();
    await here.browser.close();
  }
}

runTestMain(runTest);
