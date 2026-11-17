/**
 * Checks the first-run screens at phone width for the two failures that make an
 * installed app feel broken on a phone, neither of which axe reports.
 *
 * 1. Horizontal overflow. One element wider than the viewport makes the whole
 *    page scroll sideways, and every subsequent tap lands slightly off.
 * 2. Tap targets under 24x24 CSS px — the WCAG 2.2 floor. axe measures colour,
 *    names and roles, not size, so a 16px control passes every accessibility
 *    gate already in place while being genuinely hard to hit with a thumb.
 *    Three shipped that way: the landing Settings link, the password reveal,
 *    and the close button on EVERY dialog in the app.
 *
 * Pre-auth screens only, so it needs no backend and runs beside the other
 * production-bundle checks. That is also where it matters most: these are the
 * screens someone meets before they have any reason to persevere.
 */
import { spawn } from 'node:child_process';
import { spawnPreview, dismissConnectionFailure } from './lib/preview-world.mjs';
import { assertParity, newParityContext } from './lib/ci-parity.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { chromium } from 'playwright';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.MOBILE_CHECK_PORT ?? 4178);
const ORIGIN = `http://localhost:${PORT}`;
// These checks drive the production bundle, where first-run onboarding is ON
// (isOnboardingEnabled in src/lib/debug-config.ts). They exercise the
// registration wizard but are not testing onboarding, so they opt out with the
// explicit off-switch -- the same one a production Playwright run uses for its
// fixture accounts. Without it the intent dialog intercepts the click on
// create-account and #serverAddress never appears, which is exactly how
// check:mobile failed when onboarding landed.
const APP = `${ORIGIN}/?onboarding=0`;
const MIN_TARGET = 24;

/** Narrowest first, so the first failure reported is the hardest case. */
const WIDTHS = [320, 360, 375];

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(`${ORIGIN}/`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Runs in the page: overflow width, and every interactive element under the floor. */
function measurePage(min) {
  const root = document.documentElement;
  // `[role="slider"]` and `[role="tab"]` are here because the elements that
  // carry them are not buttons. Radix puts `role="slider"` on a `<span>` and
  // the tab triggers were only caught because they happen to be `<button>` --
  // a selector list is another screen list, and it drifts the same way.
  const interactive =
    'button,a,[role="button"],[role="switch"],[role="slider"],[role="tab"],' +
    'input[type="checkbox"],input[type="radio"]';
  const small = [...document.querySelectorAll(interactive)]
    .filter((el) => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      return box.width < min || box.height < min;
    })
    .map((el) => {
      const box = el.getBoundingClientRect();
      const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24);
      return `${el.tagName}"${label}" ${Math.round(box.width)}x${Math.round(box.height)}`;
    });
  return { overflow: root.scrollWidth - root.clientWidth, small };
}

async function main() {
  if (!existsSync(join(APP_ROOT, 'dist', 'index.html'))) {
    console.error('\n  dist/ is missing — run `npm run build` first.\n');
    process.exit(1);
  }

  const preview = spawnPreview(APP_ROOT, PORT);
  if (!(await waitForServer())) {
    preview.kill();
    console.error('\n  vite preview did not start.\n');
    process.exit(1);
  }

  assertParity();
  const browser = await chromium.launch();
  // A throw part-way used to lose every result gathered before it: the run died
  // with a Playwright stack trace and printed no table, so a genuine failure
  // recorded earlier was invisible. A check that reports nothing when it breaks
  // has failures indistinguishable from its own infrastructure.
  let crashed = null;
  try {
    // 375 was the only width measured, described as "the smallest widely-used
    // phone". It is not: 360 is the most common Android width and 320 is the
    // floor a responsive layout is normally held to. Both were measured before
    // being added here and both already pass, so this is a lock rather than a
    // repair -- but a layout that fits at 375 and breaks at 360 breaks for more
    // people than one that breaks at 375.
    for (const width of WIDTHS) {
    const context = await newParityContext(browser, {
      viewport: { width, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    // Testids, not button copy.
    //
    // These read `getByRole('button', { name: /Join Workspace/i })` and
    // `/Login Workspace/i`, which is what those buttons said before they were
    // renamed to "Sign In" and "Create Account" -- because neither old label was
    // English and "Join" meant *create an account*. The integration suite was
    // migrated to testids when that happened and this script was not, so it has
    // been failing on a thirty-second locator timeout ever since, invisibly:
    // it needs a browser and a served build, so it never runs in preflight, and
    // the job it lives in was already failing earlier for other reasons.
    //
    // Fixing those earlier gates is what surfaced this one. A dead check behind
    // a failing check is indistinguishable from a passing one.
    const screens = [
      ['landing', async () => { await page.goto(APP, { waitUntil: 'domcontentloaded' }); }],
      ['create-account', async () => {
        await page.getByTestId('create-account-button').click();
      }],
      ['sign-in', async () => {
        await page.goto(APP, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('sign-in-button').click();
      }],
      ['manage-accounts', async () => {
        await page.goto(APP, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('manage-accounts-button').click();
      }],
      // The join wizard's later steps, which is where the toast collision was.
      //
      // The check-nothing-covers-a-control assertion was written for a defect on
      // the PROFILE step -- an ambient toast sitting on the Join button -- and
      // its first negative control passed, because this list stopped at the
      // first step of the wizard. A rule that cannot reach the screen it was
      // written for is a rule about nothing.
      ['join/security', async () => {
        await page.goto(APP, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('create-account-button').click();
        await page.locator('#serverAddress').waitFor({ state: 'visible', timeout: 30_000 });
        await page.locator('#serverAddress').fill('127.0.0.1:12349');
        await page.locator('#password').fill('password123');
        await page.locator('button[type="submit"]').first().click();
        await page.getByRole('heading', { name: /Security/i }).waitFor({ state: 'visible', timeout: 30_000 });
      }],
      ['join/profile', async () => {
        await page.goto(APP, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('create-account-button').click();
        await page.locator('#serverAddress').waitFor({ state: 'visible', timeout: 30_000 });
        await page.locator('#serverAddress').fill('127.0.0.1:12349');
        await page.locator('#password').fill('password123');
        await page.locator('button[type="submit"]').first().click();
        await page.getByRole('heading', { name: /Security/i }).waitFor({ state: 'visible', timeout: 30_000 });
        await page.locator('button').filter({ hasText: /^Next$/ }).last().click();
        await page.locator('#fullName').waitFor({ state: 'visible', timeout: 30_000 });
      }],
      // Settings, and every tab in it.
      //
      // Round 210 added these to the ACCESSIBILITY gate and not to this one,
      // and the tap-target defects they were hiding went on shipping: the five
      // tab triggers at 59x23 and every Switch in the app at 39x21, both under
      // WCAG 2.2's floor, both found by a Playwright spec that needs a backend
      // rather than by the check that runs in seconds.
      //
      // Extending one gate's screen list and not the other's is the same
      // never-propagated fix this campaign keeps recording, applied to my own
      // work two rounds later.
      // Four tabs of six (Security joined them: it opens without a session and says so). Connect and Perms are disabled without a session
      // ("Connect to a workspace first"), and the forced click used to go
      // straight through that -- so two of these five surfaces measured
      // whichever tab was already open, under someone else's name. The same
      // two, in the same way, in the accessibility gate; see round 231.
      ...['General', 'Theme', 'Privacy', 'Security'].map((tab) => [
        `settings/${tab}`,
        async () => {
          // Fresh load, then wait for the tab rather than sleeping. The
          // conditional version depended on the previous surface leaving the
          // Settings modal open -- a hidden sequence that timed out in CI when
          // a click landed a fraction later than it does locally.
          await page.goto(APP, { waitUntil: 'domcontentloaded' });
          await page.locator('button').filter({ hasText: /^Settings$/ }).first().click();
          const trigger = page.locator('[role="tab"]').filter({ hasText: tab }).first();
          await trigger.waitFor({ state: 'visible', timeout: 30_000 });
          await trigger.click();
        },
      ]),
    ];

    for (const [name, go] of screens) {
      await go();
      // The agent-down modal, dismissed before anything is measured.
      //
      // The port is pinned closed (lib/preview-world.mjs), so it always arrives.
      // Left standing it covers the screen under test: its own buttons get
      // measured for tap size, and the screen's own controls are hidden and
      // therefore SKIPPED -- a surface can pass by being invisible.
      await dismissConnectionFailure(page);
      // Settle transitions before measuring: a box mid-animation is not its size.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))))
        .catch(() => {});
      await page.waitForTimeout(400);

      const { overflow, small } = await page.evaluate(measurePage, MIN_TARGET);
      record(`${width}px ${name}: fits the viewport`, overflow <= 0, overflow > 0 ? `${overflow}px of sideways scroll` : '');
      record(`${width}px ${name}: tap targets are at least ${MIN_TARGET}px`, small.length === 0, small.join('; '));

      // Nothing floating may sit on the control you were about to press.
      //
      // At 375px the "Ready to work offline" toast occupied 559-651px and the
      // join form's submit button 572-607px, so `elementFromPoint` at the centre
      // of "Join" returned the toast: the last button of first-run registration
      // was not clickable while an ambient notice was up. Nothing failed --
      // the button was present, visible, enabled, named and the right size. Only
      // a hit test can see this, which is why neither the overflow check above
      // nor any accessibility scan reported it.
      const blocked = await page.evaluate(() => {
        const isFixed = (el) => {
          for (let node = el; node; node = node.parentElement) {
            const position = getComputedStyle(node).position;
            if (position === 'fixed' || position === 'sticky') return true;
          }
          return false;
        };
        // Only the surface the user is actually on.
        //
        // A modal covering the page behind it is the point of a modal; the first
        // run of this check reported the landing page's three buttons as
        // "covered" on every screen that opens a dialog. Radix marks the rest of
        // the page `aria-hidden`, which is the same fact stated by the app
        // itself, so both are honoured: the topmost dialog wins, and anything
        // hidden from the accessibility tree is not a control anyone can press.
        const dialogs = [...document.querySelectorAll('[role="dialog"]')];
        const scope = dialogs[dialogs.length - 1] ?? document.body;
        const out = [];
        for (const control of scope.querySelectorAll('button, a[href], input, select, textarea')) {
          if (control.closest('[aria-hidden="true"], [inert]')) continue;
          const rect = control.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) continue;
          if (control.disabled) continue;
          // The control's OWN overlay does not count against it.
          if (isFixed(control)) continue;
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(x, y);
          if (!hit || hit === control || control.contains(hit) || hit.contains(control)) continue;
          const label = (control.getAttribute('aria-label') || control.textContent || control.id || '').trim();
          const by = (hit.closest('[data-sonner-toast]') ? 'a toast' : hit.tagName.toLowerCase());
          out.push(`"${label.slice(0, 24)}" is covered by ${by}`);
        }
        return out;
      });
      record(`${width}px ${name}: nothing covers a control`, blocked.length === 0, blocked.slice(0, 3).join('; '));
    }

    await context.close();
    }
  } catch (error) {
    // The whole actionability message, not its first line: "Timeout 30000ms
    // exceeded" names neither the element nor what was in the way, and both are
    // below it.
    crashed = error instanceof Error
      ? error.message.split('\n').slice(0, 8).map((l) => l.trim()).filter(Boolean).join(' | ')
      : String(error);
  } finally {
    await browser.close();
    preview.kill();
  }

  if (crashed) {
    record('the check ran to completion', false, crashed);
  }


  const width = Math.max(...results.map((r) => r.name.length));
  console.log(`\n  Mobile layout — 375x667, ${ORIGIN} (production bundle)\n`);
  for (const r of results) {
    console.log(`  ${r.name.padEnd(width)}  ${r.ok ? 'ok' : 'FAIL'}  ${r.detail}`);
  }
  if (results.some((r) => !r.ok)) {
    console.error('\n  Mobile layout checks failed.\n');
    process.exit(1);
  }
  console.log('\n  All mobile layout checks passed.\n');
}

await main();
