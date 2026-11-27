import { strict as assert } from 'node:assert';
import { clippedUnder, reachByScrolling } from './overflow-probe.mjs';

/**
 * An app tab's overflow policy (components/office/tabs/panel-overflow.ts), measured as a workspace page
 * shows the tab (scenario `app-tab-overflow`: OfficeLayout, NodeTabs, AppTabPane, the Calendar). For
 * each tall view, at 375px and on a desktop: the view's last element is reached by scrolling only what
 * a person can scroll, and nothing in the tab's panel clips content it cannot show. The topic notice
 * above the app (scenario `app-tab-topic-waiting`) stands clear of the tab row, whole and uncovered.
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

/** The least room between the tab row's border and the notice's, and between the notice and the app below it. */
const NOTICE_GAP_PX = 8;

/**
 * The topic notice above an app tab (TopicJoinNotice) stands clear of the tab row: a gap between the
 * row's bottom border and the notice's top one, the whole box inside the tab's panel, its top edge
 * the notice's own (not the row's, not cut by the panel), Try again 44px and inside it.
 */
async function theTopicNoticeStandsClearOfTheTabRow({ page, url, viewport }) {
  try {
    const width = viewport.width < 600 ? 375 : viewport.width;
    await page.setViewportSize({ width, height: viewport.height });
    await page.goto(url('app-tab-topic-waiting'));
    await page.getByRole('tab', { name: 'Calendar' }).click();
    await page.getByTestId('topic-join-notice').waitFor({ state: 'visible' });
    const m = await page.evaluate(({ panelSel }) => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
      const status = document.querySelector('[data-testid="topic-join-notice"] [role="status"]');
      const panel = document.querySelector(panelSel);
      const retry = status.querySelector('[data-testid="topic-join-retry"]');
      const b = box(status);
      const atTopEdge = document.elementFromPoint((b.left + b.right) / 2, b.top + 0.5);
      const next = document.querySelector('[data-testid="topic-join-notice"]').parentElement.nextElementSibling;
      return {
        row: box(document.querySelector('[data-testid="node-tab-row"]')), status: b, panel: box(panel), retry: box(retry),
        panelScrollTop: panel.scrollTop, topEdgeIsTheNotice: atTopEdge !== null && status.contains(atTopEdge), below: next === null ? null : box(next),
      };
    }, { panelSel: PANEL });
    const gap = m.status.top - m.row.bottom;
    assert.ok(gap >= NOTICE_GAP_PX, `the notice's top border is ${gap.toFixed(1)}px under the tab row's; it needs ${NOTICE_GAP_PX}px`);
    assert.equal(m.panelScrollTop, 0, 'the panel opened scrolled');
    assert.ok(m.status.top >= m.panel.top && m.status.bottom <= m.panel.bottom && m.status.left >= m.panel.left && m.status.right <= m.panel.right,
      `the notice ${JSON.stringify(m.status)} leaves the tab's panel ${JSON.stringify(m.panel)}`);
    assert.ok(m.topEdgeIsTheNotice, "the notice's top edge is covered by something else");
    assert.ok(m.retry.bottom - m.retry.top >= 44 && m.retry.right - m.retry.left >= 44, `Try again is ${JSON.stringify(m.retry)}, under 44px`);
    assert.ok(m.retry.top >= m.status.top && m.retry.bottom <= m.status.bottom && m.retry.right <= m.status.right, 'Try again leaves the notice');
    assert.ok(m.below === null || m.below.top - m.status.bottom >= NOTICE_GAP_PX, `the app starts ${m.below === null ? 0 : (m.below.top - m.status.bottom).toFixed(1)}px under the notice`);
    const clipped = await page.evaluate(clippedUnder, PANEL);
    assert.deepEqual(clipped, [], `the tab's panel clips content: ${clipped.join('; ')}`);
  } finally {
    await page.setViewportSize(viewport);
  }
}

export const APP_OVERFLOW_CHECKS = { theCalendarNotificationSettingsScrollToTheirEnd, theCalendarEventFormScrollsToItsEnd, theTopicNoticeStandsClearOfTheTabRow };
