/**
 * Dev mode, measured in a real engine: the Leader/Follower badge is absent while Dev mode is off and
 * appears the moment the Advanced tab's switch turns it on, with no reload; the switch is a named,
 * full-size target. Each run starts from what this device stores, so the check turns it back off.
 */
import { strict as assert } from 'node:assert';
import { settled, targetsAreBigEnough } from './checks-controls.mjs';

const badge = (page) => page.getByTestId('dev-mode-internals').getByText(/^(Leader|Follower)$/);

async function devModeShowsTheLeaderIndicator({ page, url }) {
  await page.goto(url('settings-advanced'));
  const toggle = page.getByRole('switch', { name: 'Dev mode' });
  await toggle.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="dev-mode-switch"]')?.hasAttribute('disabled'));
  await settled(page);
  assert.equal(await toggle.getAttribute('aria-checked'), 'false', 'Dev mode is not off on a device that never chose');
  assert.equal(await badge(page).count(), 0, 'the leader indicator shows with Dev mode off');
  const box = await toggle.boundingBox();
  assert.ok(box.width >= 24 && box.height >= 24, `the Dev mode switch is ${box.width}x${box.height}px`);
  await toggle.click();
  await badge(page).waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
  const shown = await badge(page).count();
  await toggle.click();
  assert.equal(shown, 1, 'turning Dev mode on did not show the leader indicator');
  await page.waitForFunction(() => document.querySelector('[data-testid="dev-mode-switch"]')?.getAttribute('aria-checked') === 'false');
}

export const DEV_MODE_CHECKS = {
  devModeShowsTheLeaderIndicator,
  targetsInAdvancedSettings: targetsAreBigEnough('settings-advanced', '[role="dialog"]'),
};
