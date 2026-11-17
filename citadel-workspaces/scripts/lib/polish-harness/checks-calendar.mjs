import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });
const focusedDate = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-date') ?? null);
const tabStops = (grid) => grid.locator('[role="gridcell"][tabindex="0"]').count();

async function open(page, url, scenario, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(url(scenario));
  await page.getByTestId('calendar-tab').waitFor({ state: 'visible' });
  await settled(page);
}

/**
 * Every day of the month is reached by keyboard alone (design §3.10): Tab enters the grid on the
 * focused day; the arrows walk to every other day, focus following each; the grid stays one tab
 * stop throughout, and one Tab leaves it.
 */
async function everyDayOfTheMonthIsReachableByKeyboard({ page, url, viewport }) {
  await open(page, url, 'calendar-month', viewport.width, viewport.height);
  const grid = page.getByTestId('calendar-month-grid');
  for (let presses = 0; presses < 40 && (await focusedDate(page)) === null; presses += 1) await page.keyboard.press('Tab');
  assert.equal(await focusedDate(page), '2024-07-16', 'Tab does not enter the grid on the focused day');
  const visited = new Set(['2024-07-16']);
  const walk = async (key, presses) => {
    for (let i = 0; i < presses; i += 1) {
      await page.keyboard.press(key);
      const date = await focusedDate(page);
      assert.ok(date !== null, `after ${key}, focus left the grid's days`);
      assert.equal(await tabStops(grid), 1, `after ${key} to ${date}, the grid is not exactly one tab stop`);
      visited.add(date);
    }
  };
  await walk('ArrowLeft', 15);
  await walk('ArrowRight', 30);
  const july = Array.from({ length: 31 }, (_, i) => `2024-07-${String(i + 1).padStart(2, '0')}`);
  const missed = july.filter((d) => !visited.has(d));
  assert.deepEqual(missed, [], `days the keyboard never reached: ${missed.join(', ')}`);
  await page.keyboard.press('Tab');
  assert.equal(await grid.evaluate((g) => g.contains(document.activeElement)), false, 'one Tab does not leave the grid');
}

/**
 * Each view at 375px and on a desktop: no sideways scroll, nothing past the pane's edges, and
 * every control a finger reaches at least 44 by 44 px (set in px; the root is 14px).
 */
const TARGETS = '[data-testid="calendar-tab"] button, [data-testid="calendar-tab"] [role="gridcell"]';
const fits = (scenario) => async ({ page, url, viewport }) => {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await open(page, url, scenario, width, viewport.height);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
  const tab = await page.getByTestId('calendar-tab').boundingBox();
  const toolbar = await page.getByTestId('calendar-toolbar').locator('button').evaluateAll((nodes) => nodes.map((n) => ({ id: n.textContent || n.getAttribute('aria-label'), ...n.getBoundingClientRect().toJSON() })));
  for (const b of toolbar) {
    assert.ok(b.width >= 44 && b.height >= 44, `${b.id} is a ${b.width}x${b.height} target`);
    assert.ok(b.x >= tab.x - 0.5 && b.x + b.width <= tab.x + tab.width + 0.5, `${b.id} overhangs the calendar`);
  }
  if (width === 375) {
    const small = await page.locator(TARGETS).evaluateAll((nodes) => nodes
      .filter((n) => n.getClientRects().length > 0)
      .map((n) => ({ id: n.getAttribute('aria-label') ?? n.textContent, ...n.getBoundingClientRect().toJSON() }))
      .filter((r) => r.width < 44 || r.height < 44));
    assert.deepEqual(small, [], `targets under 44px at 375px: ${JSON.stringify(small.slice(0, 3))}`);
  }
};

/** axe finds nothing serious or critical in a view, measured at rest. */
const accessible = (scenario) => async ({ page, url, viewport }) => {
  await open(page, url, scenario, viewport.width, viewport.height);
  const result = await new AxeBuilder({ page }).include('[data-testid="calendar-tab"]').analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  assert.deepEqual(serious.map((v) => `${v.id}: ${v.nodes.length}`), [], `axe: ${serious.map((v) => `${v.id} at ${v.nodes[0]?.target}`).join('; ')}`);
};

export const CALENDAR_CHECKS = {
  everyDayOfTheMonthIsReachableByKeyboard,
  theMonthFits: fits('calendar-month'),
  theWeekFits: fits('calendar-week'),
  theDayFits: fits('calendar-day'),
  theAgendaFits: fits('calendar-agenda'),
  theMonthIsAccessible: accessible('calendar-month'),
  theWeekIsAccessible: accessible('calendar-week'),
  theDayIsAccessible: accessible('calendar-day'),
  theAgendaIsAccessible: accessible('calendar-agenda'),
};
