import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * The Calendar's placeholder in each state the zone view gives it, in its settings card and in its
 * tab, fits a 375px phone and a desktop: no sideways scroll, every card and its words inside the
 * viewport, each action a px-sized 44px target inside the viewport, and axe finds nothing serious.
 */
const fitsInEveryState = (scenario) => async ({ page, url, viewport }) => {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  try {
    await page.goto(url(scenario));
    const cards = page.locator('[data-testid^="placeholder-card-"]');
    await cards.first().waitFor({ state: 'visible' });
    assert.equal(await cards.count(), 6, 'one card per state');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
    for (const key of ['needs-answer', 'install', 'ask-admin', 'failed', 'not-available', 'ready-unmounted']) {
      const card = page.getByTestId(`placeholder-card-${key}`);
      const b = await card.boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= width + 0.5, `the ${key} card ${JSON.stringify(b)} leaves the ${width}px viewport`);
      const clipped = await card.locator('p, span').evaluateAll((ps) => ps.filter((p) => p.scrollWidth > p.clientWidth + 1).map((p) => p.textContent));
      assert.deepEqual(clipped, [], `the ${key} card's words do not wrap`);
    }
    const ACTIONS = [['needs-answer', 'Allow and start Calendar'], ['needs-answer', 'Start without it'], ['install', 'Install Calendar'], ['ask-admin', 'Copy link for an admin'], ['failed', 'Try again']];
    for (const [key, name] of ACTIONS) {
      const action = page.getByTestId(`placeholder-card-${key}`).getByRole('button', { name });
      const b = await action.boundingBox();
      assert.ok(b !== null, `the ${key} card has no "${name}"`);
      assert.ok(b.height >= 44 && b.width >= 44, `"${name}" is a ${b.width}x${b.height} target`);
      assert.ok(b.x >= 0 && b.x + b.width <= width + 0.5, `"${name}" ${JSON.stringify(b)} leaves the viewport`);
      const minHeight = await action.evaluate((el) => getComputedStyle(el).minHeight);
      assert.equal(minHeight, '44px', `"${name}" is sized by ${minHeight}, not 44px`);
    }
    for (const key of ['not-available', 'ready-unmounted']) {
      assert.equal(await page.getByTestId(`placeholder-card-${key}`).getByRole('button').count(), 0, `nothing to press when ${key}`);
    }
    const { violations } = await new AxeBuilder({ page }).include('[data-testid^="placeholder-card-"]').withTags(WCAG).analyze();
    const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    assert.equal(blocking.length, 0, blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('; '));
  } finally {
    await page.setViewportSize(viewport);
  }
};

export const APP_SETTINGS_CHECKS = {
  theCalendarSettingsSayWhyAndWhatToDo: fitsInEveryState('app-settings-placeholders'),
  theCalendarTabSaysWhyAndWhatToDo: fitsInEveryState('app-tab-placeholders'),
};
