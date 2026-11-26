import { strict as assert } from 'node:assert';
import { clippedUnder, reachByScrolling } from './overflow-probe.mjs';

/**
 * An app tab's overflow policy (components/office/tabs/panel-overflow.ts), measured as a workspace page
 * shows the tab (scenario `app-tab-overflow`: OfficeLayout, NodeTabs, AppTabPane, the Calendar). For
 * each tall view, at 375px and on a desktop: the view's last element is reached by scrolling only what
 * a person can scroll, and nothing in the tab's panel clips content it cannot show.
 */
const PANEL = '[role="tabpanel"][data-state="active"]';
const LAST = '[data-overflow-last]';

async function openTab(page, url, viewport) {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  await page.goto(url('app-tab-overflow'));
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByTestId('calendar-tab').waitFor({ state: 'visible' });
}

/** Marks the last element of `root` in document order that is laid out and holds no element. */
async function markLast(page, root) {
  const marked = await page.evaluate((sel) => {
    const leaves = [...document.querySelector(sel).querySelectorAll('*')].filter((n) => n.children.length === 0 && n.getClientRects().length > 0);
    const last = leaves.at(-1);
    if (last === undefined) return null;
    last.setAttribute('data-overflow-last', '');
    return `${last.tagName.toLowerCase()} "${(last.textContent || last.getAttribute('aria-label') || '').trim().slice(0, 40)}"`;
  }, root);
  assert.ok(marked !== null, `${root} lays nothing out`);
  return marked;
}

async function reachesItsEndUnclipped(page, root, what) {
  const last = await markLast(page, root);
  const blocked = await page.evaluate(reachByScrolling, LAST);
  assert.equal(blocked, null, `${what}: its last element, ${last}, cannot be scrolled to: ${blocked}`);
  const clipped = await page.evaluate(clippedUnder, PANEL);
  assert.deepEqual(clipped, [], `${what}: the tab's panel clips content: ${clipped.join('; ')}`);
}

async function theCalendarNotificationSettingsScrollToTheirEnd({ page, url, viewport }) {
  try {
    await openTab(page, url, viewport);
    await page.getByRole('button', { name: 'Notifications', exact: true }).click();
    await page.getByRole('button', { name: 'Back to the calendar' }).waitFor({ state: 'visible' });
    await page.getByText('Preview', { exact: true }).waitFor({ state: 'visible' });
    await reachesItsEndUnclipped(page, '[data-testid="calendar-pane"]', 'the notification settings');
  } finally {
    await page.setViewportSize(viewport);
  }
}

async function theCalendarEventFormScrollsToItsEnd({ page, url, viewport }) {
  try {
    await openTab(page, url, viewport);
    await page.getByRole('button', { name: 'New', exact: true }).first().click();
    await page.getByTestId('calendar-event-editor').waitFor({ state: 'visible' });
    await page.getByLabel('Where').selectOption('in_person');
    await reachesItsEndUnclipped(page, '[data-testid="calendar-event-editor"]', 'the event form');
  } finally {
    await page.setViewportSize(viewport);
  }
}

export const APP_OVERFLOW_CHECKS = { theCalendarNotificationSettingsScrollToTheirEnd, theCalendarEventFormScrollsToItsEnd };
