import { strict as assert } from 'node:assert';

/** A card is measured at rest: mid-animation its box is the scaled, translated frame, not where it lands. */
const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });

/**
 * The delivery tick opens its details by keyboard (and so by tap), as a disclosure IN the message: it
 * covers none of the message's own text, stays on screen at phone width, and a second press closes it.
 * Measured on both chats, because they are two components.
 */
const detailsOpenWithoutAMouse = (scenario, rowSelector) => async ({ page, url, viewport }) => {
  await page.goto(url(scenario));
  const trigger = page.getByTestId('message-status-details-trigger').first();
  await trigger.waitFor({ state: 'visible' });
  const box = await trigger.boundingBox();
  assert.ok(box.width >= 24 && box.height >= 24, `the tick is a ${box.width}x${box.height} target (WCAG 2.2 floor is 24)`);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('message-status-details').first();
  await panel.waitFor({ state: 'visible', timeout: 3000 });
  await settled(page);
  const panelBox = await panel.boundingBox();
  assert.ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= viewport.width, `the details ${JSON.stringify(panelBox)} leave the ${viewport.width}px viewport`);
  const row = page.locator(rowSelector).filter({ has: trigger });
  const texts = await row.locator('p').evaluateAll((nodes) => nodes.filter((n) => !n.closest('[data-testid="message-status-details"]')).map((n) => n.getBoundingClientRect().toJSON()));
  assert.ok(texts.length > 0, 'the message has text to be covered');
  for (const t of texts) {
    const overlaps = t.x < panelBox.x + panelBox.width && panelBox.x < t.x + t.width && t.y < panelBox.y + panelBox.height && panelBox.y < t.y + t.height;
    assert.equal(overlaps, false, `the details ${JSON.stringify(panelBox)} cover the message text ${JSON.stringify(t)}`);
  }
  await page.keyboard.press('Enter');
  await panel.waitFor({ state: 'detached', timeout: 3000 });
};

/**
 * The "?" beside a field is a button of its own beside the label, and does not lie on the control it
 * explains (it used to sit over the select's value and swallow the click aimed at it).
 */
async function aHelpHintLiesOnNothing({ page, url, viewport }) {
  await page.goto(url('security-hints'));
  const hints = page.getByRole('button', { name: /^About / });
  await hints.first().waitFor({ state: 'visible' });
  const count = await hints.count();
  assert.ok(count >= 2, `the scenario has two hinted fields, found ${count}`);
  const fields = page.getByRole('combobox');
  for (let i = 0; i < count; i += 1) {
    const hint = await hints.nth(i).boundingBox();
    assert.ok(hint.width >= 24 && hint.height >= 24, `hint ${i} is a ${hint.width}x${hint.height} target`);
    const field = await fields.nth(i).boundingBox();
    assert.ok(hint.y + hint.height <= field.y + 1 || hint.y >= field.y + field.height - 1, `hint ${i} ${JSON.stringify(hint)} lies on its field ${JSON.stringify(field)}`);
  }
  await hints.first().focus();
  await page.keyboard.press('Enter');
  const card = page.locator('[role="dialog"]').first();
  await card.waitFor({ state: 'visible', timeout: 3000 });
  await settled(page);
  const box = await card.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, `the hint card ${JSON.stringify(box)} leaves the viewport`);
}

export const OVERLAY_CHECKS = {
  theDeliveryDetailsOpenWithoutAMouse: detailsOpenWithoutAMouse('p2p-conversation', '[data-message-id]'),
  theNodeChatDeliveryDetailsOpenWithoutAMouse: detailsOpenWithoutAMouse('node-chat', '[data-message-id]'),
  aHelpHintLiesOnNothing,
};
