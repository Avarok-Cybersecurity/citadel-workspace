import { strict as assert } from 'node:assert';

/**
 * An app's toolbar at 375px and on a desktop: no sideways scroll; every button inside the bar and
 * the viewport, a 44px target, named by its label (an app's markup shows as its text); the bar
 * above the zone, never over it; and the first button reached from the keyboard.
 */
const theAppToolbarFits = async ({ page, url, viewport }) => {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  try {
    await page.goto(url('app-toolbar-full'));
    const bar = page.getByRole('toolbar', { name: 'Compute Pool actions' });
    await bar.waitFor({ state: 'visible' });
    const box = await bar.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5, `the bar ${JSON.stringify(box)} leaves the ${width}px viewport`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
    const buttons = await bar.getByRole('button').evaluateAll((nodes) => nodes.map((n) => ({ label: n.textContent, ...n.getBoundingClientRect().toJSON() })));
    assert.equal(buttons.length, 8, 'the scenario draws the most buttons a toolbar may have');
    for (const b of buttons) {
      assert.ok(b.x >= box.x - 0.5 && b.x + b.width <= box.x + box.width + 0.5, `"${b.label}" ${JSON.stringify(b)} overhangs the bar ${JSON.stringify(box)}`);
      assert.ok(b.height >= 44 && b.width >= 44, `"${b.label}" is a ${b.width}x${b.height} target`);
    }
    assert.equal(await bar.getByRole('button', { name: '<b>Plain</b>', exact: true }).count(), 1, 'an app label is its text, never markup');
    assert.equal(await bar.locator('b').count(), 0, 'no element came from a label');
    const zone = await page.getByTestId('app-toolbar-zone').boundingBox();
    assert.ok(box.y + box.height <= zone.y + 0.5, `the bar ${JSON.stringify(box)} overlaps the zone ${JSON.stringify(zone)}`);
    // WebKit, like Safari, moves Tab between fields only; Alt+Tab is its every-control traversal.
    const webkit = page.context().browser()?.browserType().name() === 'webkit';
    await page.keyboard.press(webkit ? 'Alt+Tab' : 'Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Run', 'the first button is reached from the keyboard');
  } finally {
    await page.setViewportSize(viewport);
  }
};

export const APP_TOOLBAR_CHECKS = { theAppToolbarFits };
