import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

const overlaps = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
const within = (inner, outer) => inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5;

/**
 * The moved document's banner, opened all the way (details and the original as text): nothing
 * widens the page, every control is a 44px target inside the banner, the original's text wraps
 * inside its box (no sideways scroll, even for an unbroken link), the download button never
 * lies on the note beside it, and axe finds nothing in light or dark.
 */
async function theMigrationBannerFits({ page, url, viewport }) {
  await page.goto(url('migration-banner'));
  const banner = page.getByTestId('migration-loss-banner');
  await banner.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Show details' }).click();
  await page.getByTestId('migration-show-original').click();
  const text = page.getByTestId('migration-original-text');
  await text.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
  const box = await banner.boundingBox();
  assert.ok(box.x >= -0.5 && box.x + box.width <= viewport.width + 0.5, `the banner ${JSON.stringify(box)} leaves the ${viewport.width}px viewport`);

  const buttons = await banner.locator('button').evaluateAll((nodes) => nodes.filter((n) => n.getClientRects().length > 0).map((n) => ({ name: n.textContent.trim(), ...n.getBoundingClientRect().toJSON() })));
  assert.ok(buttons.length >= 3, `the scenario draws its controls, found ${buttons.length}`);
  for (const b of buttons) {
    assert.ok(b.width >= 44 && b.height >= 44, `${b.name} is a ${b.width}x${b.height} target`);
    assert.ok(within(b, box), `${b.name} ${JSON.stringify(b)} overhangs the banner ${JSON.stringify(box)}`);
  }

  const shown = await text.evaluate((el) => ({ ...el.getBoundingClientRect().toJSON(), scroll: el.scrollWidth - el.clientWidth }));
  assert.ok(within(shown, box), `the original's text ${JSON.stringify(shown)} overhangs the banner`);
  assert.ok(shown.scroll <= 0, `the original's text scrolls sideways by ${shown.scroll}px instead of wrapping`);
  assert.ok(shown.width >= Math.min(200, viewport.width - 64), `the original's text is ${shown.width}px wide, too narrow to read`);

  const note = await page.getByTestId('migration-original').locator('p').first().boundingBox();
  const download = await page.getByTestId('migration-original-download').boundingBox();
  assert.ok(!overlaps(note, download), `Download ${JSON.stringify(download)} lies on the note ${JSON.stringify(note)}`);

  const { violations } = await new AxeBuilder({ page }).include('[data-testid="migration-loss-banner"]').analyze();
  assert.equal(violations.length, 0, violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join(' | '));
}

export const MIGRATION_CHECKS = { theMigrationBannerFits };
