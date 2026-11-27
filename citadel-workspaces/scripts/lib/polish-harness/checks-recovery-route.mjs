import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * A way out drawn inline (RecoveryNotice, as a Calendar panel's UnreadablePanel draws it) and the bug
 * reporter, measured in a real engine at desktop and 390px: inside the page's gutter, no sideways
 * scroll, a long sentence wrapped; every control a 44px target that works; no serious axe finding.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const GUTTER = 16;
const within = (box, width) => box.x >= GUTTER - 0.5 && box.x + box.width <= width - GUTTER + 0.5;

async function open(page, url, scenario, testId) {
  await page.goto(url(scenario));
  await page.getByTestId(testId).waitFor({ state: 'visible' });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
}

async function serious(page, selector) {
  const { violations } = await new AxeBuilder({ page }).include(selector).withTags(WCAG).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html}`);
}

async function sideways(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function anInlineWayOutFitsAndWorks({ page, url, viewport }) {
  await open(page, url, 'recovery-notice-inline', 'recovery-calendar.unreadable');
  const notice = await page.getByTestId('recovery-calendar.unreadable').boundingBox();
  assert.ok(within(notice, viewport.width), `the notice ${JSON.stringify(notice)} leaves the ${viewport.width}px page's gutter`);
  const retry = page.getByTestId('recovery-control-retry');
  const box = await retry.boundingBox();
  assert.ok(box.height >= 44 && box.width >= 44, `Try again is a ${box.width}x${box.height} target (needs 44)`);
  assert.ok(within(box, viewport.width), `Try again ${JSON.stringify(box)} leaves the gutter`);
  assert.ok((await sideways(page)) <= 0, 'the page scrolls sideways');
  await retry.click();
  assert.equal(await page.evaluate(() => document.body.getAttribute('data-retried')), 'yes', 'Try again did nothing');
  assert.deepEqual(await serious(page, '[data-testid="recovery-calendar.unreadable"]'), [], 'axe found serious problems in the notice');
}

async function theBugReporterFitsAndSaysWhatItSends({ page, url, viewport }) {
  await open(page, url, 'bug-report-dialog', 'bug-report-dialog');
  const dialog = await page.getByTestId('bug-report-dialog').boundingBox();
  assert.ok(dialog.x >= -0.5 && dialog.x + dialog.width <= viewport.width + 0.5, `the dialog ${JSON.stringify(dialog)} is wider than the ${viewport.width}px page`);
  const send = await page.getByTestId('bug-report-send').boundingBox();
  assert.ok(send.height >= 44, `Send is ${send.height}px tall (needs 44)`);
  assert.ok(send.x >= dialog.x - 0.5 && send.x + send.width <= dialog.x + dialog.width + 0.5, 'Send leaves the dialog');
  assert.ok((await sideways(page)) <= 0, 'the page scrolls sideways');
  // Opened, "What will be sent" lists each item with its own Remove: each a 44px target inside the dialog.
  await page.getByText(/^What will be sent/).click();
  const removes = page.getByTestId('bug-report-remove-item');
  assert.ok((await removes.count()) > 0, 'the opened preview lists nothing to remove');
  for (let i = 0; i < await removes.count(); i += 1) {
    await removes.nth(i).scrollIntoViewIfNeeded();
    const remove = await removes.nth(i).boundingBox();
    const frame = await page.getByTestId('bug-report-dialog').boundingBox();
    assert.ok(remove.width >= 44 && remove.height >= 44, `Remove ${i} is a ${remove.width}x${remove.height} target (needs 44)`);
    assert.ok(remove.x >= frame.x - 0.5 && remove.x + remove.width <= frame.x + frame.width + 0.5, `Remove ${i} ${JSON.stringify(remove)} leaves the dialog ${JSON.stringify(frame)}`);
  }
  assert.ok((await sideways(page)) <= 0, 'the opened preview scrolls the page sideways');
  assert.deepEqual(await serious(page, '[data-testid="bug-report-dialog"]'), [], 'axe found serious problems in the bug reporter');
}

export const RECOVERY_ROUTE_CHECKS = { anInlineWayOutFitsAndWorks, theBugReporterFitsAndSaysWhatItSends };
