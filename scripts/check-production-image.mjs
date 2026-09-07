/**
 * Drives a real browser against the real production image.
 *
 * This is the only check that does. Every Playwright spec runs against the Vite
 * dev server, which applies no Content-Security-Policy and no
 * Permissions-Policy; production nginx applies both. A feature can pass all 84
 * specs and be dead on deploy — which is exactly what happened to audio/video
 * calling, shipped under `Permissions-Policy: microphone=(), camera=()`, an
 * empty allowlist that denies every origin including its own.
 *
 * smoke-ui-ws.sh already asserts the header TEXT with curl. This asserts what
 * the browser DOES with it: a policy can be present, well-formed and still not
 * grant what the app needs, and `featurePolicy.allowsFeature()` is the browser's
 * own answer rather than our reading of a string.
 *
 * Usage: node scripts/check-production-image.mjs <image> [port]
 */
import { execFileSync, execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { appMounted } from './lib/app-mounted.mjs';
import { walkRegistrationWithHostname } from './lib/hostname-costs-no-violation.mjs';

const IMAGE = process.argv[2] ?? 'ghcr.io/avarok-cybersecurity/citadel-workspace-ui:latest';
const PORT = Number(process.argv[3] ?? 18100);
const NAME = `citadel-prodcheck-${PORT}`;
const ORIGIN = `http://localhost:${PORT}`;

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });

function stopContainer() {
  try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* not running */ }
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${ORIGIN}/`)).ok) return true; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  stopContainer();
  execFileSync('docker', ['run', '-d', '--name', NAME, '-p', `${PORT}:8080`, IMAGE], { stdio: 'ignore' });

  if (!(await waitForServer())) {
    stopContainer();
    console.error(`\n  ${IMAGE} did not start serving on ${PORT}.\n`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Audits.enable');
    const issues = [];
    cdp.on('Audits.issueAdded', (e) => issues.push(e.issue));

    await page.goto(ORIGIN, { waitUntil: 'networkidle' });
    await page.waitForTimeout(4_000);

    // The app has to actually mount. A blank page under a correct CSP is still
    // a broken deploy -- and so is a page whose only content is the root error
    // boundary, which is what this asserted for as long as it read
    // `root.children.length > 0`.
    const mounted = await appMounted(page);
    record('the app mounts under the production policy', mounted.ok, mounted.detail);

    // The browser's own verdict on the permission, not our reading of a header.
    const media = await page.evaluate(() => {
      const fp = document.featurePolicy ?? document.permissionsPolicy;
      const allows = (f) => {
        try { return fp ? fp.allowsFeature(f) : null; } catch { return null; }
      };
      return {
        getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
        camera: allows('camera'),
        microphone: allows('microphone'),
        display: allows('display-capture'),
      };
    });
    record('getUserMedia exists', media.getUserMedia === true);
    record('the browser grants camera to this origin', media.camera === true, `allowsFeature=${media.camera}`);
    record('the browser grants microphone to this origin', media.microphone === true, `allowsFeature=${media.microphone}`);
    record('the browser grants display-capture', media.display === true, `allowsFeature=${media.display}`);

    // CSP violations.
    //
    // The eval exemption below is now historical: 'unsafe-eval' is granted, so
    // neither cbor-x's `new Function` probe nor the MDX renderer produces a
    // violation any more. It stays only because a browser that reports an eval
    // refusal for some other reason should not fail this check on a policy that
    // permits eval — every other kind of violation still does.
    const csp = issues.filter((i) => i.code === 'ContentSecurityPolicyIssue');
    const unexpected = csp.filter((i) => {
      const d = i.details?.contentSecurityPolicyIssueDetails ?? {};
      return d.contentSecurityPolicyViolationType !== 'kEvalViolation';
    });
    record(
      'no unexpected CSP violations',
      unexpected.length === 0,
      unexpected.map((i) => i.details?.contentSecurityPolicyIssueDetails?.violatedDirective).join(', '),
    );

    // ---- First-run onboarding is ON in the artefact users get. ----
    //
    // The requirement is that onboarding runs in production and NOT in
    // development, so the integration suite's ~90 account creations do not each
    // pay the two extra interactions it costs. Everything that checked it until
    // now checked one side of that:
    //
    //   - onboarding-gate.test.ts asserts `isOnboardingEnabled()` with
    //     `import.meta.env.DEV` mocked. That is the gate's LOGIC, not the
    //     bundle's value of DEV.
    //   - the onboarding specs run against the Vite DEV server and force
    //     `?onboarding=1`, which returns at the param branch of
    //     `isOnboardingEnabled` BEFORE `!isDev` is ever evaluated.
    //
    // So a production build with DEV somehow true — a wrong `--mode`, a stray
    // `.env`, a Docker build arg — would ship with no onboarding at all, and
    // every existing check would still be green.
    //
    // Here there is no query parameter and a fresh context has no
    // `citadel:onboarding` key, so `isOnboardingEnabled()` can only reach
    // `return !isDev`. The dialog appearing therefore proves the SHIPPED bundle
    // has DEV false. Nothing else made that claim.
    //
    // Both branches are asserted because both were asked for: the new
    // administrator, who must be told about the master password before the
    // wizard, and the new member, who must be told they do not need it.
    const onboardingContext = await browser.newContext();
    const onboardingPage = await onboardingContext.newPage();
    let onboarding = { shown: false, admin: 0, member: 0, beforeWizard: false, detail: '' };
    try {
      await onboardingPage.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
      await onboardingPage.click('[data-testid="create-account-button"]', { timeout: 30_000 });
      await onboardingPage.waitForSelector('[data-testid="onboarding-intent"]', { timeout: 15_000 });
      onboarding = {
        shown: true,
        admin: await onboardingPage.locator('[data-testid="onboarding-intent-admin"]').count(),
        member: await onboardingPage.locator('[data-testid="onboarding-intent-member"]').count(),
        // It has to come BEFORE the wizard, not beside it. Naming the master
        // password after the step that needs it is the thing being fixed.
        beforeWizard: (await onboardingPage.locator('[data-testid="wizard-next"]').count()) === 0,
        detail: '',
      };
    } catch (error) {
      onboarding.detail = String(error).split('\n')[0];
    }
    record('first-run onboarding appears with no query override', onboarding.shown, onboarding.detail);
    record('the new-administrator branch is offered', onboarding.admin === 1, `count=${onboarding.admin}`);
    record('the new-member branch is offered', onboarding.member === 1, `count=${onboarding.member}`);
    record('it comes before the wizard, not beside it', onboarding.beforeWizard);
    await onboardingContext.close();

    // ---- Both branches are WALKED, on the artefact users get. ----
    //
    // Everything above asserts the two buttons EXIST. A button that exists and
    // does nothing satisfies all of it -- and this repository has shipped
    // exactly that more than once, most recently the landing doors that
    // answered a click with no dialog, no message and no navigation.
    //
    // So each branch is clicked and required to reach the wizard, and the two
    // are required to DIFFER. The difference is the dialog's own promise:
    // "joining a workspace someone else set up" means the visitor does not hold
    // WORKSPACE_MASTER_PASSWORD, and the copy tells them they should not be
    // asked for it. That answer is recorded in sessionStorage; the
    // administrator's is not, because an administrator SHOULD be prompted.
    //
    // Without the difference assertion, both buttons wired to the same handler
    // would pass -- and the member would be asked for a secret they cannot have,
    // which is the failure the whole dialog exists to prevent.
    const INIT_PROMPT_SUPPRESSED_KEY = 'workspace-init-modal-dismissed';
    const walkOnboarding = async (branch) => {
      const context = await browser.newContext();
      const walkPage = await context.newPage();
      const result = { wizard: false, recorded: null, detail: '' };
      try {
        await walkPage.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
        await walkPage.click('[data-testid="create-account-button"]', { timeout: 30_000 });
        await walkPage.waitForSelector('[data-testid="onboarding-intent"]', { timeout: 15_000 });
        await walkPage.click(`[data-testid="onboarding-intent-${branch}"]`, { timeout: 15_000 });
        // The wizard's first step, not the dialog's absence: absence is also
        // what a click that did nothing at all looks like.
        await walkPage.waitForSelector('[data-testid="wizard-next"]', { timeout: 15_000 });
        result.wizard = true;
        result.recorded = await walkPage.evaluate((key) => {
          try {
            return window.sessionStorage.getItem(key);
          } catch {
            // Storage can throw under strict privacy settings. Distinguished
            // from `null` because "refused" and "not written" send a support
            // conversation in different directions.
            return 'storage-threw';
          }
        }, INIT_PROMPT_SUPPRESSED_KEY);
      } catch (error) {
        result.detail = String(error).split('\n')[0];
      }
      await context.close();
      return result;
    };

    // Typing a HOSTNAME must not cost a CSP violation.
    //
    // The check above collects violations from the landing page only, and the
    // defect this guards against lives three screens further in: a build that
    // resolved the address with `fetch('https://dns.google/resolve?...')` was
    // refused by its own `connect-src`, and every new user on work.avarok.net
    // got "Registration timed out" instead of an account. `reached` is asserted
    // as well as the violation count, because a walk that fell over early also
    // reports zero violations.
    const hostnameWalk = await walkRegistrationWithHostname(browser, ORIGIN, 'citadel.example.net:12400');
    record(
      'the registration walk reaches submit',
      hostnameWalk.reached === 'submitted',
      `${hostnameWalk.reached}${hostnameWalk.detail ? ' — ' + hostnameWalk.detail : ''}`,
    );
    record(
      'typing a hostname costs no CSP violation',
      hostnameWalk.violations.length === 0,
      hostnameWalk.violations.join(', '),
    );

    const asMember = await walkOnboarding('member');
    const asAdmin = await walkOnboarding('admin');
    record('a new member reaches the wizard', asMember.wizard, asMember.detail);
    record('a new administrator reaches the wizard', asAdmin.wizard, asAdmin.detail);
    record(
      'choosing "joining" is recorded, so the member is not asked for the master password',
      asMember.recorded === 'true',
      `sessionStorage=${asMember.recorded}`,
    );
    record(
      'choosing "setting up" is NOT recorded, so the administrator still is',
      asAdmin.recorded !== 'true',
      `sessionStorage=${asAdmin.recorded}`,
    );

    // The control. Without it, a dialog hard-wired to render unconditionally
    // satisfies every assertion above — and would then cost the integration
    // suite the ~180 interactions this switch exists to avoid. So this asserts
    // the SWITCH, not just the dialog.
    //
    // The pass signal is `wizard-next`, the wizard's first step, and not the
    // absence of the dialog: absence is also what a page that never rendered
    // the button, or never handled the click, looks like. An earlier version
    // used "the Create Account button went away" as the click-landed proxy and
    // was simply wrong — the wizard overlays the landing page, so the button
    // stays in the DOM and the control reported a failure that was not one.
    const suppressedContext = await browser.newContext();
    const suppressedPage = await suppressedContext.newPage();
    let suppressed = { wizard: false, dialogs: -1, detail: '' };
    try {
      await suppressedPage.goto(`${ORIGIN}/?onboarding=0`, { waitUntil: 'domcontentloaded' });
      await suppressedPage.click('[data-testid="create-account-button"]', { timeout: 30_000 });
      await suppressedPage.waitForSelector('[data-testid="wizard-next"]', { timeout: 15_000 });
      suppressed = {
        wizard: true,
        dialogs: await suppressedPage.locator('[data-testid="onboarding-intent"]').count(),
        detail: '',
      };
    } catch (error) {
      suppressed.detail = String(error).split('\n')[0];
    }
    record('?onboarding=0 opens the wizard directly', suppressed.wizard, suppressed.detail);
    record('?onboarding=0 shows no intent dialog', suppressed.dialogs === 0, `count=${suppressed.dialogs}`);
    await suppressedContext.close();

    // ---- The PWA promise: it opens with no network at all. ----
    //
    // check-pwa-offline.mjs already asserts this story in full, but against the
    // BUNDLE via `vite preview`. This repeats the load against the nginx IMAGE,
    // where the bundle can be perfect and the server in front of it wrong: a
    // `sw.js` with the wrong cache headers, or a missing SPA fallback, breaks
    // offline without touching a line of app code.
    //
    // The dialog assertion below is the one this adds outright. A check that
    // looks for the offline BANNER passes whether or not a modal is sitting on
    // top of it, and for a while one was.
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'no serviceWorker API';
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      return reg?.active ? 'active' : 'never activated';
    });
    record('the service worker activates', swState === 'active', swState);

    await context.setOffline(true);
    // domcontentloaded, not networkidle: offline there is no network to go
    // idle, and waiting for it times out on a page that loaded perfectly.
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(6_000);

    const offlineMount = await appMounted(page);
    const offline = await page.evaluate(() => ({
      // Nothing modal should stand between the user and a shell that loaded
      // fine. The offline banner says what happened; a dialog telling them to
      // check a connection they know is down only blocks the page.
      dialogs: document.querySelectorAll('[role="dialog"]').length,
    }));
    // This used to be "#root has children AND an h1 with any text in it". The
    // error boundary is a div under #root containing an h1 reading "Something
    // went wrong" -- so a crashed app satisfied both halves.
    record('the shell renders with no network', offlineMount.ok, offlineMount.detail);
    record('nothing blocks the page while offline', offline.dialogs === 0,
      `${offline.dialogs} dialog(s)`);
    await context.setOffline(false);

    await context.close();
  } finally {
    await browser.close();
    stopContainer();
  }

  const width = Math.max(...results.map((r) => r.name.length));
  console.log(`\n  Production image — ${IMAGE}\n`);
  for (const r of results) {
    console.log(`  ${r.name.padEnd(width)}  ${r.ok ? 'ok' : 'FAIL'}  ${r.detail}`);
  }
  if (results.some((r) => !r.ok)) {
    console.error('\n  The production image does not support the features this app ships.\n');
    process.exit(1);
  }
  console.log('\n  All production image checks passed.\n');
}

await main();
