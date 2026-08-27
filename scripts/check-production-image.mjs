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
    // a broken deploy.
    const mounted = await page.evaluate(() => {
      const root = document.getElementById('root');
      return Boolean(root && root.children.length > 0);
    });
    record('the app mounts under the production policy', mounted);

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

    const offline = await page.evaluate(() => ({
      mounted: Boolean(document.getElementById('root')?.children.length),
      heading: document.querySelector('h1')?.textContent?.trim().length ?? 0,
      // Nothing modal should stand between the user and a shell that loaded
      // fine. The offline banner says what happened; a dialog telling them to
      // check a connection they know is down only blocks the page.
      dialogs: document.querySelectorAll('[role="dialog"]').length,
    }));
    record('the shell renders with no network', offline.mounted && offline.heading > 0,
      `mounted=${offline.mounted} headingChars=${offline.heading}`);
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
