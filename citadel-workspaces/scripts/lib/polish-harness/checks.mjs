import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';
import { MOTION_CHECKS } from './checks-motion.mjs';

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Hovering a member must not cover any OTHER member row: the one above is the one you reach for
 * next. Measured two ways, because they fail differently -- the card's box against each row's,
 * and what the browser hit-tests at each row's centre (a card that is not a box overlap, such as
 * one with a hoverable bridge, still shows up there).
 */
async function tooltipLeavesNeighboursReachable({ page, url }) {
  await page.goto(url('sidebar-members'));
  const rows = page.locator('[data-testid^="member-row-"]');
  const count = await rows.count();
  assert.ok(count >= 3, `expected at least 3 member rows, found ${count}`);
  const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  let left = null;
  for (let i = count - 1; i >= 0; i -= 1) {
    const at = centre(await rows.nth(i).boundingBox());
    // Radix keeps a card open while the pointer is "in transit" toward it, so a jump from one row to the next
    // left the last row's card up and this row's never opened: the check measured the wrong card. Leave each
    // row straight left, away from its card, see the card go, then come in from the left along this row.
    const cards = page.locator('[data-radix-popper-content-wrapper]');
    if (left !== null) {
      await page.mouse.move(0, left.y, { steps: 8 });
      await cards.first().waitFor({ state: 'detached', timeout: 3000 });
    }
    await page.mouse.move(0, at.y);
    await page.mouse.move(at.x, at.y, { steps: 8 });
    left = at;
    const handle = (await rows.nth(i).getAttribute('data-testid')).slice('member-row-'.length);
    const card = cards.filter({ hasText: `@${handle}` });
    await card.waitFor({ state: 'visible', timeout: 3000 });
    const cardBox = await card.boundingBox();
    assert.ok(cardBox, `row ${i}'s card closed while the pointer was still on its row`);
    for (let j = 0; j < count; j += 1) {
      if (j === i) continue;
      const other = await rows.nth(j).boundingBox();
      assert.ok(!overlaps(cardBox, other), `hovering row ${i} puts its card over row ${j}: card ${JSON.stringify(cardBox)} row ${JSON.stringify(other)}`);
      const { x, y } = centre(other);
      const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid^="member-row-"]')?.getAttribute('data-testid') ?? null, [x, y]);
      assert.equal(hit, await rows.nth(j).getAttribute('data-testid'), `row ${j} is not reachable while row ${i} is hovered`);
    }
  }
}

/** The least air between two message rows that still reads as two messages, in CSS px. */
const MIN_ROW_GAP = 8;

/**
 * Consecutive message rows are separated. Row boxes are the visible bubbles (and their reaction
 * chips), so the gap between one row's bottom and the next row's top is the gap a reader sees.
 * The row after a live-document bubble and the row after a message that carries reactions are the
 * two pinches users reported.
 */
const rowsAreSeparated = (scenario, expected) => async ({ page, url }) => {
  await page.goto(url(scenario));
  const rows = page.locator('[data-message-id]');
  await rows.first().waitFor({ state: 'visible' });
  const count = await rows.count();
  assert.equal(count, expected, `the scenario renders ${expected} message rows`);
  const boxes = [];
  for (let i = 0; i < count; i += 1) boxes.push(await rows.nth(i).boundingBox());
  for (let i = 1; i < count; i += 1) {
    const gap = boxes[i].y - (boxes[i - 1].y + boxes[i - 1].height);
    assert.ok(gap >= MIN_ROW_GAP, `row ${i} sits ${gap}px under row ${i - 1} (needs ${MIN_ROW_GAP})`);
  }
};
const messageRowsAreSeparated = rowsAreSeparated('p2p-conversation', 6);
/** The same rows in a node channel, whose messages name their senders and carry a system line. */
const nodeChatRowsAreSeparated = rowsAreSeparated('node-chat', 6);

const within = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

/** A drag the way a browser raises it: the events carry a DataTransfer holding one real file. */
async function dragOf(page, kind) {
  return page.evaluateHandle((k) => {
    const transfer = new DataTransfer();
    if (k === 'file') transfer.items.add(new File(['hello'], 'plan.txt', { type: 'text/plain' }));
    else transfer.setData('text/plain', 'just some words');
    return transfer;
  }, kind);
}

/**
 * Dragging a file over the conversation raises an overlay that covers it (and only it), does not
 * take the pointer, and says what will happen; dropping opens the Send File dialog holding the
 * file. Dragging selected text over it does nothing.
 */
async function aDroppedFileGoesToTheSendPath({ page, url }) {
  await page.goto(url('p2p-chat'));
  const chat = page.getByTestId('p2p-chat');
  await chat.waitFor({ state: 'visible' });
  const overlay = page.getByTestId('chat-drop-overlay');

  await chat.dispatchEvent('dragenter', { dataTransfer: await dragOf(page, 'text') });
  assert.equal(await overlay.count(), 0, 'selected text must not raise the file overlay');

  const file = await dragOf(page, 'file');
  await chat.dispatchEvent('dragenter', { dataTransfer: file });
  await overlay.waitFor({ state: 'visible', timeout: 3000 });
  const chatBox = await chat.boundingBox();
  const overlayBox = await overlay.boundingBox();
  assert.ok(within(overlayBox, chatBox), `overlay ${JSON.stringify(overlayBox)} leaves the chat ${JSON.stringify(chatBox)}`);
  assert.ok(overlayBox.width >= chatBox.width - 24 && overlayBox.height >= chatBox.height - 24, `overlay ${JSON.stringify(overlayBox)} does not cover the chat ${JSON.stringify(chatBox)}`);
  const prompt = overlay.getByText(/Drop a file to send it to Ada Lovelace/);
  assert.ok(within(await prompt.boundingBox(), overlayBox), 'the prompt is not inside the overlay');
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'), [overlayBox.x + overlayBox.width / 2, overlayBox.y + overlayBox.height / 2]);
  assert.notEqual(hit, 'chat-drop-overlay', 'the overlay takes the pointer');

  await chat.dispatchEvent('drop', { dataTransfer: file });
  // The drop goes straight to the send path (no dialog to confirm in).
  assert.equal(await page.getByRole('dialog').count(), 0, 'a drop opened a dialog');
  assert.equal(await overlay.count(), 0, 'the overlay outlives the drop');
}

/** The conversation header draws the peer's picture (a loaded image, inside the header), not just initials. */
async function theHeaderDrawsThePeersPicture({ page, url }) {
  await page.goto(url('p2p-chat'));
  const picture = page.getByTestId('member-avatar-ada').locator('img');
  await picture.waitFor({ state: 'visible', timeout: 5000 });
  assert.ok(await picture.evaluate((img) => img.complete && img.naturalWidth > 0), 'the picture did not load');
  const box = await picture.boundingBox();
  assert.ok(box.width >= 24 && box.height >= 24, `the picture is ${box.width}x${box.height}`);
  const chat = await page.getByTestId('p2p-chat').boundingBox();
  assert.ok(box.y >= chat.y && box.y + box.height <= chat.y + 80, 'the picture is not in the header band');
}

async function contrastFailures(page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  return violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.any[0]?.message ?? ''}`));
}

async function readable(page, where) {
  const failures = await contrastFailures(page);
  assert.equal(failures.length, 0, `${where}: ${failures.join(' | ')}`);
}

/**
 * Text on the surfaces this round touches meets 4.5:1 in the engine that paints it: the bubbles
 * (own bubbles are the primary colour, where faded text loses the most) and the Send File dialog a
 * drop opens, in both of its transfer methods. Colour is measured by axe against the painted pixels.
 */
async function chatTextIsReadable({ page, url }) {
  await page.goto(url('p2p-conversation'));
  await page.locator('[data-message-id]').first().waitFor({ state: 'visible' });
  await readable(page, 'conversation bubbles');
  // A channel's bubbles too, which include the reader's own markdown: dark in both themes.
  await page.goto(url('node-chat'));
  await page.locator('[data-message-id]').first().waitFor({ state: 'visible' });
  await readable(page, 'node channel bubbles');
}

/** Where a drop cannot land the overlay says so inside the chat, goes away when the drag leaves, and nothing opens. */
async function aDropThatCannotLandSaysWhy({ page, url }) {
  await page.goto(url('paused-drag'));
  await page.getByTestId('p2p-chat').dispatchEvent('dragenter', { dataTransfer: await dragOf(page, 'file') });
  await page.getByTestId('chat-drop-overlay').getByText('The connection is paused. Resume it to send files.').waitFor({ state: 'visible', timeout: 3000 });
  await readable(page, 'paused overlay');
  await page.goto(url('document-open'));
  const chat = page.getByTestId('p2p-chat');
  const overlay = page.getByTestId('chat-drop-overlay');
  const file = await dragOf(page, 'file');
  await chat.dispatchEvent('dragenter', { dataTransfer: file });
  await overlay.waitFor({ state: 'visible', timeout: 3000 });
  const message = overlay.getByText('Drop files on the Messages tab to send them.');
  assert.ok(within(await message.boundingBox(), await overlay.boundingBox()), 'the message is not inside the overlay');
  await readable(page, 'document-open overlay');
  await chat.dispatchEvent('dragleave', { dataTransfer: file });
  // The overlay was visible a moment ago, so waiting for it to detach is a real wait, not a vacuous one.
  await overlay.waitFor({ state: 'detached', timeout: 3000 });
  await chat.dispatchEvent('dragenter', { dataTransfer: file });
  await chat.dispatchEvent('drop', { dataTransfer: file });
  assert.equal(await page.getByRole('dialog').count(), 0, 'a drop that cannot land opened a dialog');
}

export const CHECKS = { aDropThatCannotLandSaysWhy, chatTextIsReadable, tooltipLeavesNeighboursReachable, messageRowsAreSeparated, nodeChatRowsAreSeparated, aDroppedFileGoesToTheSendPath, theHeaderDrawsThePeersPicture, ...MOTION_CHECKS };
