import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * The "Sign in with Citadel" consent dialog (sign-in-with-citadel.md §8, design §7 P16), measured in a
 * real engine at desktop and 390px: a page dialog inside the viewport with no sideways scroll, the
 * three match words drawn at 24px or more, the unlock field a password field, Approve disabled until
 * it holds something, every control inside the dialog and at least the 24px WCAG 2.2 target, and no
 * serious or critical axe finding. The widest scenario carries the schema's longest display name, an
 * unbreakable 64-character client id and an error line.
 */
const MIN_WORD_PX = 24;
const MIN_TARGET_PX = 24;
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const theConsentDialogFits = (scenario) => async ({ page, url, viewport }) => {
  await page.goto(url(scenario));
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  const box = await dialog.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 0.5, `the dialog ${JSON.stringify(box)} leaves the ${viewport.width}px viewport`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);

  const words = await dialog.getByTestId('sign-in-match-words').locator('li').evaluateAll(
    (items) => items.map((li) => ({ text: li.textContent, px: parseFloat(getComputedStyle(li).fontSize), ...li.getBoundingClientRect().toJSON() })),
  );
  assert.deepEqual(words.map((w) => w.text), ['argue', 'occur', 'napkin'], 'the three match words are drawn, in order');
  for (const w of words) {
    assert.ok(w.px >= MIN_WORD_PX, `match word "${w.text}" is ${w.px}px, under ${MIN_WORD_PX}px`);
    assert.ok(w.x >= box.x - 0.5 && w.x + w.width <= box.x + box.width + 0.5, `match word "${w.text}" overhangs the dialog`);
  }

  const field = dialog.getByTestId('sign-in-unlock-password');
  assert.equal(await field.getAttribute('type'), 'password', 'the unlock field is a password field');
  const approve = dialog.getByTestId('sign-in-approve');
  assert.ok(await approve.isDisabled(), 'Approve is disabled while the password is empty');
  await field.fill('x');
  assert.ok(await approve.isEnabled(), 'Approve is enabled once the password holds something');

  const controls = await dialog.locator('button, input').evaluateAll(
    (nodes) => nodes.filter((n) => n.getClientRects().length > 0).map((n) => ({ id: n.dataset.testid ?? n.getAttribute('aria-label') ?? n.tagName, ...n.getBoundingClientRect().toJSON() })),
  );
  assert.ok(controls.length >= 4, `the dialog draws its controls, found ${controls.length}`);
  for (const c of controls) {
    assert.ok(c.x >= box.x - 0.5 && c.x + c.width <= box.x + box.width + 0.5, `${c.id} ${JSON.stringify(c)} overhangs the dialog ${JSON.stringify(box)}`);
    assert.ok(c.height >= MIN_TARGET_PX && c.width >= MIN_TARGET_PX, `${c.id} is a ${c.width}x${c.height} target`);
  }

  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG).analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  assert.equal(blocking.length, 0, blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('; '));
};

export const SIGN_IN_CHECKS = {
  theSignInConsentDialogFits: theConsentDialogFits('sign-in-consent'),
  theSignInConsentDialogFitsAtItsWidest: theConsentDialogFits('sign-in-consent-widest'),
};
