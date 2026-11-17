/**
 * Regenerates the manifest's install-card screenshots.
 *
 * A tool, not a test — it lives outside `tests-pw` for the same reason
 * visual-sweep does: it asserts almost nothing, and counting it as coverage
 * would overstate what the suite checks.
 *
 * Run it when the landing page changes:
 *   npx playwright test src/tools/capture-pwa-screenshots.spec.ts --config=playwright.config.ts
 *
 * Chrome shows its richer install dialog — the one with a description and
 * imagery, rather than a bare "Install?" — only when the manifest carries
 * screenshots, and only shows the wide one on desktop if a `wide` form_factor
 * is present. Both are captured here.
 *
 * The LANDING page is captured on purpose. The obvious alternative, a real
 * workspace, needs an account, and every account this suite can make is named
 * something like `pw_admin_1787638996620` — a generated test handle on the
 * install card of a shipped product is worse than no screenshot at all.
 */

import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { waitForAppReady } from '../lib/index.js';
import { config } from '../lib/config.js';

const OUT = path.resolve(process.cwd(), '../public/screenshots');

/** Must match the `sizes` declared in vite.config.ts's manifest exactly. */
const SHOTS = [
  { name: 'wide.png', width: 1280, height: 800 },
  { name: 'narrow.png', width: 412, height: 915 },
];

test('capture install-card screenshots', async ({ browser }) => {
  test.setTimeout(180_000);
  await mkdir(OUT, { recursive: true });

  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
    });
    const page = await context.newPage();
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await waitForAppReady(page, 60_000);

    // Settle anything still animating in, or the capture catches a half-faded
    // hero. Infinite animations are skipped — waiting on a spinner never ends.
    await page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((a) => {
          const timing = a.effect?.getTiming();
          return timing && timing.iterations === Infinity ? null : a.finished.catch(() => {});
        }),
      );
    });

    await page.screenshot({ path: path.join(OUT, shot.name) });
    // A blank or error page still screenshots fine, so prove the real thing is
    // on screen before this replaces the shipped asset.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await context.close();
  }
});
