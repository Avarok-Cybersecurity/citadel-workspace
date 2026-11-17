/**
 * On a phone, a toast must not land on the fixed header.
 *
 * Toasts come from the top on small viewports because at the bottom they sat on
 * the join form's submit button -- `elementFromPoint` at the centre of "Join"
 * returned the toast, and nothing failed: the button was present, visible,
 * enabled and named, and a tap landed on the notice.
 *
 * They then sat on the TOP BAR instead. A CI probe reported the account avatar
 * as `on screen | covered by li.group` -- a Sonner toast, which renders each
 * toast as an `<li>` whose first class is `group`. While one was up, the only
 * route to Profile, Settings and Sign Out was untappable.
 *
 * This is measured in a browser, not asserted in jsdom, because two earlier
 * attempts were wrong in ways only layout can reveal:
 *
 *  1. Sonner's `offset` prop accepts a string and did not take effect --
 *     measured `--offset-top: 32px`, the default.
 *  2. Overriding `--offset-top` in CSS resolved the calc and moved nothing:
 *     below its own breakpoint Sonner positions the toaster with
 *     `top: var(--mobile-offset-top)`.
 *
 * A jsdom test asserting "the style attribute mentions --app-header-height"
 * passed throughout all of that. It could not see position, so it could not see
 * that nothing had moved.
 */
import { chromium } from 'playwright';
import { spawnPreview, dismissConnectionFailure } from './lib/preview-world.mjs';

const PORT = 4189;
const ORIGIN = `http://localhost:${PORT}`;
/** What AppLayout writes; the landing page has no header, so it is set here. */
const HEADER_PX = 56;

const preview = spawnPreview(process.cwd(), PORT);
let failed = false;
try {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(ORIGIN)).ok) break; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 375, height: 667 } })).newPage();
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
  await dismissConnectionFailure(page);
  await page.evaluate((px) => {
    document.documentElement.style.setProperty('--app-header-height', `${px}px`);
  }, HEADER_PX);

  const measured = await page.evaluate(() => {
    const toast = document.querySelector('[data-sonner-toast]');
    if (!toast) return null;
    return Math.round(toast.getBoundingClientRect().top);
  });

  if (measured === null) {
    console.error('\n  No toast on screen to measure — the probe cannot conclude anything.\n');
    failed = true;
  } else if (measured < HEADER_PX) {
    console.error(
      `\n  A toast lands at y=${measured}, inside the ${HEADER_PX}px header.\n` +
        '  Everything in the top bar is untappable while it is up: the account\n' +
        '  menu, the notification bell, the workspace switcher.\n',
    );
    failed = true;
  } else {
    console.log(`  Toast clears the header on a phone (y=${measured} vs ${HEADER_PX}px)  ok`);
  }

  await browser.close();
} finally {
  preview.kill();
}

process.exit(failed ? 1 : 0);
