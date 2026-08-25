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

    // CSP violations, minus the one that is understood and deliberate.
    //
    // cbor-x probes for `new Function` inside a try/catch and falls back to its
    // interpreted path when the policy refuses. Chrome reports the refusal
    // anyway. Allowing 'unsafe-eval' to silence it would trade a real security
    // boundary for a quieter console, so the probe is expected and skipped —
    // but ONLY the eval kind, so a genuine violation still fails this.
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
