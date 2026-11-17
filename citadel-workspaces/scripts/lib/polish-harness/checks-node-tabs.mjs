import { strict as assert } from 'node:assert';

/**
 * A node's tab row at 375px and on a desktop, at its fullest: no sideways page scroll; every tab a
 * 44px-tall target at least 72px wide; "+" and the tab menu 44x44, inside the viewport however far
 * the tabs scroll; the last tab reachable by scrolling the row; arrow keys move between tabs.
 * With no default tabs, the notice fits and its words wrap rather than leave the viewport.
 */
const theNodeTabRowFits = async ({ page, url, viewport }) => {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  try {
    await page.goto(url('node-tabs-full'));
    const list = page.getByRole('tablist', { name: 'Page tabs' });
    await list.waitFor({ state: 'visible' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
    const tabs = await list.getByRole('tab').evaluateAll((nodes) => nodes.map((n) => ({ label: n.textContent, ...n.getBoundingClientRect().toJSON() })));
    assert.equal(tabs.length, 10, 'page, chat and eight app tabs');
    for (const t of tabs) assert.ok(t.height >= 44 && t.width >= 72, `"${t.label}" is a ${t.width}x${t.height} tab`);
    for (const name of ['Add a tab', 'Tab options']) {
      const b = await page.getByRole('button', { name }).boundingBox();
      assert.ok(b.width >= 44 && b.height >= 44, `"${name}" is a ${b.width}x${b.height} target`);
      assert.ok(b.x >= 0 && b.x + b.width <= width + 0.5, `"${name}" ${JSON.stringify(b)} leaves the ${width}px viewport`);
    }
    const last = list.getByRole('tab').last();
    await last.scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    const scroller = await page.getByTestId('node-tab-scroller').boundingBox();
    assert.ok(box.x >= scroller.x - 0.5 && box.x + box.width <= scroller.x + scroller.width + 0.5, `the last tab ${JSON.stringify(box)} cannot be scrolled into the row ${JSON.stringify(scroller)}`);
    await list.getByRole('tab').first().focus();
    await page.waitForFunction(() => document.activeElement?.textContent === 'Page');
    await page.keyboard.press('ArrowRight');
    // Polled, not read once: the roving focus moves on the frame after the key.
    const moved = await page.waitForFunction(() => document.activeElement?.textContent === 'Chat', null, { timeout: 2000 }).then(() => true, () => false);
    assert.ok(moved, `the arrow key left focus on "${await page.evaluate(() => document.activeElement?.textContent)}", not the next tab`);
    assert.equal(await list.getByRole('tab', { selected: true }).count(), 1, 'exactly one tab is selected');

    await page.goto(url('node-tabs-no-default'));
    const notice = page.getByTestId('node-tab-notice');
    await notice.waitFor({ state: 'visible' });
    const n = await notice.boundingBox();
    assert.ok(n.x >= 0 && n.x + n.width <= width + 0.5, `the notice ${JSON.stringify(n)} leaves the ${width}px viewport`);
    const after = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(after <= 0, `the notice makes the page scroll sideways by ${after}px`);
  } finally {
    await page.setViewportSize(viewport);
  }
};

/**
 * The marketplace's tab view at 375px and on a desktop: the heading naming a long page wraps
 * inside the viewport, nothing scrolls sideways, and every card's action is a 44px target inside
 * the viewport, installed-here first ("Add as a tab"), the others "Install and add".
 */
const theTabViewFits = async ({ page, url, viewport }) => {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  try {
    await page.goto(url('apps-for-tab'));
    const heading = page.getByTestId('apps-browse-for-tab');
    await heading.waitFor({ state: 'visible' });
    const h = await heading.boundingBox();
    assert.ok(h.x >= 0 && h.x + h.width <= width + 0.5, `the heading ${JSON.stringify(h)} leaves the ${width}px viewport`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `the tab view scrolls sideways by ${overflow}px`);
    const actions = await page.getByTestId('apps-listing-tab-action').evaluateAll((nodes) => nodes.map((n) => ({ label: n.textContent, ...n.getBoundingClientRect().toJSON() })));
    assert.deepEqual(actions.map((a) => a.label), ['Add as a tab', 'Install and add', 'Install and add'], 'installed here first');
    for (const a of actions) assert.ok(a.height >= 44 && a.x >= 0 && a.right <= width + 0.5, `"${a.label}" is ${JSON.stringify(a)} at ${width}px`);
  } finally {
    await page.setViewportSize(viewport);
  }
};

/**
 * Only the selected tab's panel is laid out, and it takes the pane's height below the row. Radix
 * hides an unselected panel with the `hidden` attribute, which a display class outranks: an app
 * tab's panel is `flex`, so every unselected app tab kept an equal share of the column, and at
 * 375x667 the office chat's transcript was left 0px tall -- a message's actions could not be
 * tapped, because the scroll area's padding sat over them.
 */
const onlyTheSelectedPanelTakesTheHeight = async ({ page, url }) => {
  await page.goto(url('node-tabs-full'));
  const list = page.getByRole('tablist', { name: 'Page tabs' });
  await list.waitFor({ state: 'visible' });
  for (const name of ['Page', 'Chat', 'Calendar']) {
    const tab = list.getByRole('tab', { name, exact: true });
    await tab.click();
    await page.waitForFunction((label) => [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some((t) => t.textContent === label), name);
    const laidOut = await page.locator('[role="tabpanel"]').evaluateAll((nodes) => nodes
      .filter((n) => n.getClientRects().length > 0)
      .map((n) => ({ id: n.id, state: n.getAttribute('data-state'), top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom })));
    assert.equal(laidOut.length, 1, `with "${name}" selected, ${laidOut.length} panels are laid out: ${JSON.stringify(laidOut)}`);
    assert.equal(laidOut[0].state, 'active', `with "${name}" selected, the panel laid out is ${laidOut[0].id}`);
    const pane = await page.getByTestId('node-tabs-pane').boundingBox();
    const row = await list.boundingBox();
    const panel = laidOut[0];
    assert.ok(panel.top >= row.y + row.height - 0.5 && Math.abs(panel.bottom - (pane.y + pane.height)) <= 1.5,
      `with "${name}" selected, its panel spans ${panel.top}-${panel.bottom}, not the pane's ${row.y + row.height}-${pane.y + pane.height} below the row`);
  }
};

export const NODE_TAB_CHECKS = { theNodeTabRowFits, theTabViewFits, onlyTheSelectedPanelTakesTheHeight };
