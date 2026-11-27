import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * A refused install (marketplace/InstallRefused.tsx) at 375px and on a desktop: the answer, the
 * managers' line and every next-step button sit inside the view, each a 44px target, no two
 * buttons overlap, nothing scrolls sideways, and the text to copy by hand (the clipboard refused)
 * wraps its long link instead of widening the page. No serious axe finding.
 */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5;
const overlap = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

const theRefusalFits = (scenario, buttons, managersLine) => async ({ page, url, viewport }) => {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  try {
    await page.goto(url(scenario));
    const view = page.getByTestId('apps-install-failed');
    await view.waitFor({ state: 'visible' });
    const box = await view.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5, `the view ${JSON.stringify(box)} leaves the ${width}px viewport`);
    assert.equal(await page.getByTestId('apps-install-failed-managers').count(), managersLine ? 1 : 0, 'the managers’ line is drawn for managers only');
    const steps = await view.locator('button').evaluateAll((nodes) => nodes.map((n) => ({ id: n.dataset.testid, ...n.getBoundingClientRect().toJSON() })));
    assert.deepEqual(steps.map((s) => s.id), buttons, 'the next steps, in order');
    for (const s of steps) {
      assert.ok(inside(s, box), `${s.id} ${JSON.stringify(s)} overhangs the view ${JSON.stringify(box)}`);
      assert.ok(s.height >= 44 && s.width >= 44, `${s.id} is a ${s.width}x${s.height} target`);
    }
    for (let i = 0; i < steps.length; i++) for (let j = i + 1; j < steps.length; j++) assert.ok(!overlap(steps[i], steps[j]), `${steps[i].id} overlaps ${steps[j].id}`);
    await page.getByTestId(buttons[0] === 'apps-next-ask-admin' ? 'apps-next-ask-admin' : 'apps-next-report').click();
    const byHand = page.getByTestId('apps-next-not-copied');
    await byHand.waitFor({ state: 'visible' });
    const pre = await byHand.locator('pre').boundingBox();
    assert.ok(inside(pre, box), `the text to copy ${JSON.stringify(pre)} overhangs the view ${JSON.stringify(box)}`);
    const spill = await byHand.locator('pre').evaluate((n) => n.scrollWidth - n.clientWidth);
    assert.ok(spill <= 0, `the text to copy runs ${spill}px past its box instead of wrapping`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="apps-install-failed"]').withTags(WCAG).analyze();
    const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    assert.deepEqual(serious.map((v) => v.id), [], 'no serious axe finding');
  } finally {
    await page.setViewportSize(viewport);
  }
};

export const INSTALL_REFUSED_CHECKS = {
  aMembersRefusedInstallOffersAnAdminRequestThatFits: theRefusalFits('install-refused-member', ['apps-next-ask-admin', 'apps-next-change-choice'], false),
  aManagersRefusedInstallSaysMoreAndFits: theRefusalFits('install-refused-manager', ['apps-next-change-choice', 'apps-next-report'], true),
};
