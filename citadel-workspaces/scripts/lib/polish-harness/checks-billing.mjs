/**
 * The sidebar's Admin section and "Plan & billing", as the owner reported them (2026-11-23): an
 * "Admin Privileges" row that only described privileges, and a billing dialog in the OLD styling,
 * a dark-blue panel. That panel was `DialogContent className="bg-surface"`: the elevated token for
 * menus and hover rows, painted over the dialog surface every current settings dialog keeps.
 *
 * Measured: the Admin rows are the three that do something; the dialog paints the dialog surface
 * (bg-background, as WorkspaceSettingsDialog does), not the surface token; it fits the viewport in
 * both of its forms with every answer and the claim-code field a 44px target inside it; and axe
 * finds nothing serious in either form.
 */
import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';
import { settled } from './checks-controls.mjs';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MIN_TARGET = 44;
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

async function theAdminRowsAreTheOnesThatDoSomething({ page, url }) {
  await page.goto(url('admin-settings-menu'));
  const menu = page.getByTestId('admin-settings-menu');
  await menu.waitFor({ state: 'visible' });
  const rows = (await menu.getByRole('button').allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(rows, ['Workspace settings', 'Role permissions', 'Plan & billing']);
  assert.equal(await page.getByText(/admin(istrator)? privileges/i).count(), 0, 'an "Admin Privileges" row or dialog is still drawn');
}

/** The dialog's painted background against the two tokens it could be, resolved in this page. */
async function surfaceOf(page) {
  return page.evaluate(() => {
    const paint = (className) => {
      const probe = document.createElement('div');
      probe.className = className;
      document.body.appendChild(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    };
    return {
      dialog: getComputedStyle(document.querySelector('[data-testid="plan-and-billing-dialog"]')).backgroundColor,
      background: paint('bg-background'),
      surface: paint('bg-surface'),
    };
  });
}

/** The dialog fits the viewport; each of `answers` (buttons by name, or the claim field) is a 44px target inside it. */
async function fits(page, viewport, answers) {
  const dialog = await page.getByTestId('plan-and-billing-dialog').boundingBox();
  assert.ok(inside(dialog, { x: 0, y: 0, ...viewport }), `the dialog ${JSON.stringify(dialog)} leaves the ${viewport.width}px viewport`);
  for (const [what, locator] of answers) {
    const box = await locator.boundingBox();
    assert.ok(box !== null, `${what} is not drawn`);
    assert.ok(box.height >= MIN_TARGET, `${what} is ${box.height}px tall (needs ${MIN_TARGET})`);
    assert.ok(inside(box, dialog), `${what} ${JSON.stringify(box)} leaves the dialog ${JSON.stringify(dialog)}`);
  }
  const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(width <= 0, `the page scrolls sideways by ${width}px`);
}

async function axe(page) {
  const { violations } = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(WCAG).analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  assert.equal(blocking.length, 0, blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join('; '));
}

async function planAndBillingIsTheCurrentDialog({ page, url, viewport }) {
  await page.goto(url('plan-and-billing'));
  const manage = page.getByRole('button', { name: 'Manage subscription' });
  await manage.waitFor({ state: 'visible' });
  await settled(page);
  const { dialog, background, surface } = await surfaceOf(page);
  assert.notEqual(background, surface, 'the two tokens resolve to one colour here, so this check cannot tell them apart');
  assert.equal(dialog, background, `the dialog paints ${dialog}, not the dialog surface ${background} (the surface token is ${surface})`);
  assert.equal(await page.getByLabel('Claim code').count(), 0, 'the claim code is asked before the session was');
  await fits(page, viewport, [['Manage subscription', manage], ['Cancel', page.getByRole('button', { name: 'Cancel' })]]);
  await axe(page);

  // Refused for this session: the claim code, in the same dialog.
  await manage.click();
  const field = page.getByLabel('Claim code');
  await field.waitFor({ state: 'visible' });
  await settled(page);
  await fits(page, viewport, [['the claim-code field', field], ['Manage subscription', manage], ['Cancel', page.getByRole('button', { name: 'Cancel' })]]);
  await axe(page);
}

export const BILLING_CHECKS = { theAdminRowsAreTheOnesThatDoSomething, planAndBillingIsTheCurrentDialog };
