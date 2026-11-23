/**
 * The document's encryption lock, in a real engine over the browser's real store: it says what this device
 * stores (open with nothing, locked with the "on" record), it is a 44px target with the status as its name,
 * its tooltip comes up on keyboard focus (not hover only), and pressing it opens Settings at Security,
 * where the setting is changed.
 */
import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';
import { settled } from './checks-controls.mjs';

const NAMES = { on: 'Encrypted at rest on this device', off: 'Not encrypted at rest' };

const theLockSaysWhatIsStored = (stored) => async ({ page, url }) => {
  await page.goto(url('docs-at-rest') + (stored === 'on' ? '&atRest=on' : ''));
  const lock = page.getByTestId('docs-at-rest-status');
  await page.locator(`[data-testid="docs-at-rest-status"][data-status="${stored}"]`).waitFor({ timeout: 8000 });
  await settled(page);
  assert.equal(await lock.getAttribute('aria-label'), NAMES[stored]);
  const box = await lock.boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, `the lock is ${box.width}x${box.height}px`);
  await lock.focus();
  const tip = page.getByTestId('docs-at-rest-status-tip');
  await tip.waitFor({ state: 'visible', timeout: 3000 });
  assert.ok((await tip.innerText()).includes(NAMES[stored]), `the tooltip on focus says ${await tip.innerText()}`);
  const { violations } = await new AxeBuilder({ page }).include('header').analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id);
  assert.equal(serious.length, 0, serious.join(', '));
  await page.keyboard.press('Enter');
  const security = page.getByRole('tab', { name: 'Security' });
  await security.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await security.getAttribute('aria-selected'), 'true', 'Settings did not open at Security');
};

export const AT_REST_CHECKS = {
  theLockIsOpenWithNothingStored: theLockSaysWhatIsStored('off'),
  theLockIsLockedWhenTheDeviceEncrypts: theLockSaysWhatIsStored('on'),
};
