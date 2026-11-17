import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * The Calendar tab mounted whole (scenario `calendar-mounted`: the registry's mount over real
 * ports and an in-memory store), and each panel a member opens from it: the event editor, their
 * booking page, and someone else's booking page with a day chosen. At 375px and on a desktop:
 * no sideways scroll, nothing past the pane, every control a finger reaches at least 44 by 44 px;
 * and axe finds nothing serious or critical, measured at rest.
 */
const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });

const TARGETS = [
  'button', 'select', 'textarea', '[role="gridcell"]',
  'input:not([type="checkbox"]):not([type="radio"])',
  'label:has(> input[type="checkbox"])', 'label:has(> input[type="radio"])',
].map((t) => `[data-testid="calendar-pane"] ${t}`).join(', ');

async function mounted(page, url, viewport) {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  await page.goto(url('calendar-mounted'));
  await page.getByTestId('calendar-tab').waitFor({ state: 'visible' });
  await settled(page);
  return width;
}

export async function fitsAndReads(page, width, what) {
  await settled(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `${what}: the page scrolls sideways by ${overflow}px`);
  const pane = await page.getByTestId('calendar-pane').boundingBox();
  const boxes = await page.locator(TARGETS).evaluateAll((nodes) => nodes
    .filter((n) => n.getClientRects().length > 0 && !n.classList.contains('sr-only'))
    .map((n) => ({ id: n.getAttribute('aria-label') ?? (n.textContent || n.tagName).trim().slice(0, 40), ...n.getBoundingClientRect().toJSON() })));
  const outside = boxes.filter((b) => b.x < pane.x - 0.5 || b.x + b.width > pane.x + pane.width + 0.5);
  assert.deepEqual(outside.map((b) => b.id), [], `${what}: controls past the pane's edge: ${outside.map((b) => b.id).join(', ')}`);
  if (width === 375) {
    const small = boxes.filter((b) => b.width < 44 || b.height < 44);
    const named = small.map((b) => `${b.id} ${Math.round(b.width)}x${Math.round(b.height)}`);
    assert.deepEqual(named, [], `${what}: targets under 44px at 375px: ${named.slice(0, 5).join('; ')}`);
  }
  const result = await new AxeBuilder({ page }).include('[data-testid="calendar-pane"]').analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  assert.deepEqual(serious.map((v) => `${v.id} at ${v.nodes[0]?.target}`), [], `${what}: axe`);
}

async function theMountedTabFits({ page, url, viewport }) {
  const width = await mounted(page, url, viewport);
  await fitsAndReads(page, width, 'the mounted tab');
}

/** Company's all-hands, projected here by its publisher, read through the tab's own ports and shown as from Company. */
async function anInheritedEventShowsWhereItIsFrom({ page, url, viewport }) {
  await mounted(page, url, viewport);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  const chip = page.getByRole('button', { name: /All-hands.*From Company/ }).first();
  await chip.waitFor({ state: 'visible', timeout: 5000 });
}

async function theEventEditorFits({ page, url, viewport }) {
  const width = await mounted(page, url, viewport);
  await page.getByRole('button', { name: 'New', exact: true }).first().click();
  await page.getByTestId('calendar-event-editor').waitFor({ state: 'visible' });
  await page.getByLabel('Where').selectOption('in_person');
  await page.getByLabel("One of Platform's own events (for its editors)").check();
  await page.getByLabel('On every page below Platform').check();
  await page.getByLabel('On a page above').selectOption('company');
  await fitsAndReads(page, width, 'the event editor');
}

async function theBookingSetupFits({ page, url, viewport }) {
  const width = await mounted(page, url, viewport);
  await page.getByRole('button', { name: 'Your booking page' }).click();
  await page.getByRole('button', { name: 'New event type' }).click();
  await page.getByTestId('calendar-event-type-editor').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Add a question' }).click();
  await fitsAndReads(page, width, 'the booking page setup');
}

async function theBookingPageFits({ page, url, viewport }) {
  const width = await mounted(page, url, viewport);
  await page.getByRole('button', { name: 'Book with someone' }).click();
  await page.getByRole('button', { name: 'ana', exact: true }).click();
  await page.getByRole('heading', { name: 'Book with ana' }).waitFor({ state: 'visible' });
  await page.getByRole('group', { name: 'Days with free times' }).getByRole('button').first().click();
  await page.getByTestId('calendar-slot').first().click();
  await fitsAndReads(page, width, "ana's booking page");
}

export const CALENDAR_PANEL_CHECKS = { theMountedTabFits, anInheritedEventShowsWhereItIsFrom, theEventEditorFits, theBookingSetupFits, theBookingPageFits };
