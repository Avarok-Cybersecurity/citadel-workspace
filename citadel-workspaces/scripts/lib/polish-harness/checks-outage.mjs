import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * The outage notice (components/outage), measured in a real engine at desktop and 390px: it is
 * the whole page and opaque; its icon, sentence, code and Try again are stacked in that order,
 * each centred on the page, the group centred top to bottom; the sentence keeps a gutter and wraps
 * instead of leaving the screen; Try again is a 44px target that works; no serious axe finding.
 * Each cause says its own sentence (owner decision 2026-11-27): the server's only when it is down,
 * offline and reconnecting their own, and those two wait instead of offering Try again at once.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const GUTTER = 16;
const centreX = (box) => box.x + box.width / 2;

async function open(page, url, scenario) {
  await page.goto(url(scenario));
  await page.getByTestId('service-unavailable').waitFor({ state: 'visible' });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
}

async function parts(page) {
  const box = async (testId) => page.getByTestId(testId).boundingBox();
  return {
    icon: await box('service-unavailable-icon'),
    title: await box('service-unavailable-title'),
    code: await box('service-unavailable-code'),
    retry: await box('recovery-control-retry'),
    // Try again and any other way out share one row, and the row is what is centred.
    ways: await page.getByTestId('recovery-control-retry').locator('..').boundingBox(),
    group: await page.getByRole('alert').boundingBox(),
  };
}

async function theNoticeIsCentredOnThePage({ page, url, viewport }) {
  await open(page, url, 'outage-notice');
  const { icon, title, code, retry, ways, group } = await parts(page);
  const middle = viewport.width / 2;
  for (const [what, box] of [['icon', icon], ['sentence', title], ['row of ways out', ways], ['group', group]]) {
    assert.ok(Math.abs(centreX(box) - middle) <= 1, `the ${what} is centred at ${centreX(box)}px, the page at ${middle}px`);
  }
  // The code sits in a line with its label, and the line is what is centred.
  const line = await page.getByTestId('service-unavailable-code').locator('..').boundingBox();
  assert.ok(Math.abs(centreX(line) - middle) <= 1, `the code's line is centred at ${centreX(line)}px, the page at ${middle}px`);
  // From the icon's top to Retry's bottom, not the group's box: a group stretched to the page's
  // height is centred whatever becomes of what is in it.
  const drawn = (icon.y + retry.y + retry.height) / 2;
  assert.ok(Math.abs(drawn - viewport.height / 2) <= 1, `what is drawn is centred at ${drawn}px down a ${viewport.height}px page`);
  const order = [['icon', icon], ['sentence', title], ['code', code], ['Retry', retry]];
  for (let i = 1; i < order.length; i += 1) {
    const [above, a] = order[i - 1];
    const [below, b] = order[i];
    assert.ok(a.y + a.height <= b.y + 0.5, `the ${above} ${JSON.stringify(a)} is not above the ${below} ${JSON.stringify(b)}`);
  }
  for (const [what, box] of order) {
    assert.ok(box.x >= GUTTER - 0.5 && box.x + box.width <= viewport.width - GUTTER + 0.5, `the ${what} ${JSON.stringify(box)} leaves the ${viewport.width}px page's ${GUTTER}px gutter`);
  }
  assert.equal(await page.getByTestId('service-unavailable-title').textContent(), 'The error is on us — please check back soon');
  assert.match(await page.getByTestId('service-unavailable-code').textContent(), /^CW-[A-Z-]+$/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
}

async function retryIsATargetThatWorks({ page, url }) {
  await open(page, url, 'outage-notice');
  const retry = page.getByTestId('recovery-control-retry');
  const box = await retry.boundingBox();
  assert.ok(box.height >= 44 && box.width >= 44, `Retry is a ${box.width}x${box.height} target (needs 44)`);
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-retried')), null);
  await retry.click();
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-retried')), 'yes', 'Retry did nothing');
  const { violations } = await new AxeBuilder({ page }).include('[data-testid="service-unavailable"]').withTags(WCAG).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`);
  assert.deepEqual(serious, [], 'axe found serious problems in the notice');
}

/** Over a workspace that stays mounted, nothing of it shows or can be reached: every corner and the centre hit the notice. */
async function theNoticeIsTheWholePage({ page, url, viewport }) {
  await open(page, url, 'outage-over-workspace');
  const notice = await page.getByTestId('service-unavailable').boundingBox();
  assert.deepEqual({ x: notice.x, y: notice.y, width: notice.width, height: notice.height }, { x: 0, y: 0, ...viewport }, 'the notice is not the whole viewport');
  const alpha = await page.getByTestId('service-unavailable').evaluate((el) => {
    const colour = getComputedStyle(el).backgroundColor;
    const channels = colour.match(/[\d.]+/g) ?? [];
    return colour === 'transparent' ? 0 : channels.length >= 4 ? Number(channels[3]) : 1;
  });
  assert.equal(alpha, 1, 'the workspace shows through the notice');
  const points = [[8, 8], [viewport.width - 8, 8], [8, viewport.height - 8], [viewport.width - 8, viewport.height - 8], [viewport.width / 2, 100]];
  for (const [x, y] of points) {
    const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid="service-unavailable"]') !== null, [x, y]);
    assert.ok(hit, `the workspace behind is reachable at ${x},${y}`);
  }
}

/** Offline and reconnecting: their own sentence, inside the gutter, a wait instead of a button, no serious axe finding. */
async function eachCauseSaysItsOwnSentence({ page, url, viewport }) {
  const said = {
    reconnecting: 'Reconnecting to your workspace…',
    offline: 'You’re offline. Citadel will reconnect automatically when your connection is back.',
  };
  for (const cause of ['reconnecting', 'offline']) {
    await open(page, url, 'outage-over-workspace');
    if (cause === 'offline') await page.context().setOffline(true);
    try {
      await page.locator(`[data-cause="${cause}"]`).waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('service-unavailable-title').textContent(), said[cause]);
      const title = await page.getByTestId('service-unavailable-title').boundingBox();
      assert.ok(title.x >= GUTTER - 0.5 && title.x + title.width <= viewport.width - GUTTER + 0.5, `the ${cause} sentence ${JSON.stringify(title)} leaves the gutter`);
      assert.equal(await page.getByTestId('recovery-status').isVisible(), true, `the ${cause} notice does not say it is waiting`);
      assert.equal(await page.getByRole('button', { name: /Try again|Reload/ }).count(), 0, `the ${cause} notice offers a button before its wait ends`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `the ${cause} page scrolls sideways by ${overflow}px`);
      const { violations } = await new AxeBuilder({ page }).include('[data-testid="service-unavailable"]').withTags(WCAG).analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`);
      assert.deepEqual(serious, [], `axe found serious problems in the ${cause} notice`);
    } finally {
      await page.context().setOffline(false);
    }
  }
}

export const OUTAGE_CHECKS = { theNoticeIsCentredOnThePage, retryIsATargetThatWorks, theNoticeIsTheWholePage, eachCauseSaysItsOwnSentence };
