import { strict as assert } from 'node:assert';

export const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });

/** WCAG 2.2 target size minimum, in CSS px. */
const MIN_TARGET = 24;

/**
 * An OFF switch has a boundary a person can see: its outline against what it sits on is at least 3:1
 * (WCAG 1.4.11). The track alone is the input colour, about 1.1:1 on the page, so an off switch read as
 * nothing there. axe does not measure this.
 */
async function anOffSwitchIsVisible({ page, url }) {
  await page.goto(url('settings-privacy'));
  const shown = await page.locator('[role="dialog"]').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  assert.ok(shown, `no dialog at ${page.url()}: ${(await page.evaluate(() => document.body.innerText)).slice(0, 120)}`);
  await settled(page);
  const states = await page.locator('[role="switch"]').evaluateAll((all) => all.map((el) => `${el.id}:${el.getAttribute('data-state')}`));
  const off = page.locator('[role="switch"][data-state="unchecked"]').first();
  assert.ok(await off.count() > 0, `the privacy tab has no switch that is off: ${states.join(', ')}`);
  const { outline, surface } = await off.evaluate((el) => {
    const channels = (css) => css.match(/[\d.]+/g).slice(0, 4).map(Number);
    let node = el.parentElement;
    let behind = [255, 255, 255, 1];
    while (node) {
      const c = channels(getComputedStyle(node).backgroundColor);
      if ((c[3] ?? 1) === 1) { behind = c; break; }
      node = node.parentElement;
    }
    // A transparent border draws nothing: then the boundary is the track's own fill.
    const border = channels(getComputedStyle(el).borderTopColor);
    return { outline: (border[3] ?? 1) === 0 ? channels(getComputedStyle(el).backgroundColor) : border, surface: behind };
  });
  const luminance = ([r, g, b]) => [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [hi, lo] = [luminance(outline), luminance(surface)].sort((a, b) => b - a);
  const ratio = (hi + 0.05) / (lo + 0.05);
  assert.ok(ratio >= 3, `an off switch's outline is ${ratio.toFixed(2)}:1 against what it sits on (needs 3:1)`);
}

/** Every control on the screen is a target of at least 24px, in both directions. */
export const targetsAreBigEnough = (scenario, ready) => async ({ page, url }) => {
  await page.goto(url(scenario));
  await page.locator(ready).first().waitFor({ state: 'visible' });
  await settled(page);
  const small = await page.evaluate((min) => [...document.querySelectorAll('button, [role="button"], [role="switch"], [role="tab"], [role="checkbox"], input:not([type="hidden"]), select')]
    .filter((el) => el.tabIndex >= 0 && !el.disabled && !el.closest('[aria-hidden="true"]'))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < min || r.height < min))
    .map(({ el, r }) => `${el.tagName.toLowerCase()}[${el.dataset.testid ?? el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 20)}] ${Math.round(r.width)}x${Math.round(r.height)}`), MIN_TARGET);
  assert.equal(small.length, 0, `${scenario}: ${small.slice(0, 6).join(' | ')}`);
};

export const CONTROL_CHECKS = {
  anOffSwitchIsVisible,
  targetsInTheNodeChat: targetsAreBigEnough('node-chat', '[data-message-id]'),
  targetsInTheConversation: targetsAreBigEnough('p2p-conversation', '[data-message-id]'),
  targetsInSettings: targetsAreBigEnough('settings', '[role="dialog"]'),
  targetsInPrivacySettings: targetsAreBigEnough('settings-privacy', '[role="dialog"]'),
  targetsInNotificationSettings: targetsAreBigEnough('settings-notifications', '[data-testid="settings-notifications"]'),
  targetsAmongPeople: targetsAreBigEnough('people', '[data-avatar]'),
  targetsInTheOfficeHeader: targetsAreBigEnough('office-header', '[data-testid="hierarchy-breadcrumbs"]'),
};
