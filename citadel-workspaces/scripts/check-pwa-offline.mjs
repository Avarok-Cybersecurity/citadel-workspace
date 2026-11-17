/**
 * Verifies the promise the app makes when it says "Citadel has been installed
 * and will now load without a connection".
 *
 * That claim can only be tested by actually running the thing: a service worker
 * has to register, activate and serve a navigation from cache. Static checks of
 * dist/ cannot reach it — check-pwa-installable.mjs owns those, including the
 * manifest and icons, and this deliberately does not repeat them. The split is
 * by cost: that one needs no browser and runs everywhere, this one needs a real
 * Chromium and runs where one is installed.
 *
 * Runs against `vite preview`, never the dev server: vite-plugin-pwa disables
 * the worker in development (devOptions.enabled: false) because one
 * intercepting requests makes HMR confusing to reason about. The dev server is
 * therefore the one place this can never be tested, which is why the PWA sits
 * outside the normal Playwright suite.
 *
 * Reuses the prebuilt dist/ that check-lighthouse.mjs also expects, so CI builds
 * once and every production-bundle check verifies the same artefact.
 */
import { spawn } from 'node:child_process';
import { spawnPreview } from './lib/preview-world.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const DIST = resolve(APP_ROOT, 'dist');
const PORT = Number(process.env.PWA_CHECK_PORT ?? 4174);
const ORIGIN = `http://localhost:${PORT}`;
// These checks drive the production bundle, where first-run onboarding is ON
// (isOnboardingEnabled in src/lib/debug-config.ts). They exercise the
// registration wizard but are not testing onboarding, so they opt out with the
// explicit off-switch -- the same one a production Playwright run uses for its
// fixture accounts. Without it the intent dialog intercepts the click on
// create-account and #serverAddress never appears, which is exactly how
// check:mobile failed when onboarding landed.
const APP = `${ORIGIN}/?onboarding=0`;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`preview server did not start on ${url} within ${timeoutMs}ms`);
}

const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail });
}

async function main() {
  if (!existsSync(DIST)) {
    fail('dist/ not found — run `npm run build` first.');
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    fail(
      'playwright is required.\n' +
        `  (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const preview = spawnPreview(APP_ROOT, PORT);

  let browser;
  try {
    await waitForServer(ORIGIN);

    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(APP, { waitUntil: 'load' });

    // Raced against a timeout, because `navigator.serviceWorker.ready` NEVER
    // SETTLES when no worker registers — it does not reject, so awaiting it
    // bare hangs forever. A gate that hangs is worse than one that fails: CI
    // sits until its job timeout with no diagnosis. Found by deleting sw.js to
    // check this script fails when it should, which it did not — it hung.
    const activated = await page.evaluate(async () => {
      const ready = navigator.serviceWorker.ready.then((registration) =>
        Boolean(registration.active));
      const timeout = new Promise((r) => setTimeout(() => r(false), 20_000));
      return Promise.race([ready, timeout]);
    }).catch(() => false);
    record('service worker reaches activated', activated,
      activated ? undefined : 'no worker activated within 20s');

    if (!activated) {
      // Everything below tests what the worker does, so there is nothing left
      // to learn — and reporting ten offline failures for one missing worker
      // buries the actual cause.
      report();
      return;
    }

    // The precache finishes asynchronously after activation. Going offline
    // before it completes tests a half-populated cache and fails for a reason
    // that has nothing to do with the app.
    await page.waitForTimeout(1_000);

    let told = false;
    await context.setOffline(true);
    const offlineResponse = await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);

    record('the app still loads with no connection', offlineResponse !== null,
      offlineResponse ? `served ${offlineResponse.status()} from cache` : 'navigation failed');

    if (offlineResponse) {
      // A 200 from the cache is not the same as a working app: the shell has to
      // actually mount. #root staying empty is what a broken precache looks
      // like from the user's side.
      // "Not an empty page" was the whole assertion, and it was satisfied by
      // the root error boundary -- a div under #root. While every production
      // load rendered "Something went wrong", this said ok.
      const mounted = await page
        .waitForFunction(() => {
          const root = document.getElementById('root');
          if (!root || root.children.length === 0) return false;
          if (document.querySelector('[data-testid="app-crashed"]')) return false;
          return Boolean(
            document.querySelector('[data-testid="sign-in-button"]') ||
              document.querySelector('[data-testid="create-account-button"]') ||
              document.querySelector('[data-testid="app-shell"]'),
          );
        }, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      record('the offline app renders the app, not an empty page or a crash', mounted);

      // A shell that renders but says nothing leaves the user to guess why
      // half the app is inert. The banner is the only thing that explains it,
      // and its unit test proves it renders when told it is offline — not that
      // anything ever tells it.
      told = await page
        .getByText(/You[’']re offline/i)
        .waitFor({ state: 'visible', timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      record('the user is told they are offline', told);
    }

    await context.setOffline(false);

    // The promise the banner makes is that this state ends when the connection
    // does. A banner that never clears is its own bug, and a stuck "offline" is
    // worse than none — it contradicts an app that is visibly working again.
    // Only meaningful if the notice was ever there. A banner that never
    // appeared is trivially hidden, so this reported ok for the entire time
    // the check above was failing -- an assertion that could not fail sitting
    // directly beneath the one that did.
    const cleared = told
      ? await page
          .getByText(/You[’']re offline/i)
          .waitFor({ state: 'hidden', timeout: 20_000 })
          .then(() => true)
          .catch(() => false)
      : false;
    record('and the notice clears when the connection returns', cleared,
      told ? undefined : 'the notice never appeared, so clearing proves nothing');

    report();
  } finally {
    await browser?.close();
    preview.kill();
  }
}

function report() {
  const width = Math.max(...results.map((r) => r.label.length));
  console.log(`\n  PWA offline — ${ORIGIN} (production bundle)\n`);
  for (const { label, ok, detail } of results) {
    const status = ok ? 'ok  ' : 'FAIL';
    console.log(`  ${label.padEnd(width)}  ${status}${detail ? `  ${detail}` : ''}`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n  ${failed.length} PWA offline check(s) failed.\n`);
    process.exit(1);
  }
  console.log('\n  All PWA offline checks passed.\n');
}

await main();
