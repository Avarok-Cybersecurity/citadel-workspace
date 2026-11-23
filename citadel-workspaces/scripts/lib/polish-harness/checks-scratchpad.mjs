/**
 * The scratchpad, measured: the header says what it is, whole, inside the pane, at both widths;
 * nothing a direct chat has because someone is at the other end is drawn (a call control, a
 * presence or typing line, a delivery tick); the empty transcript says it too; text is readable.
 */
import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

const LINE = 'Your private scratchpad — notes, drafts and documents only you can see.';
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y >= outer.y - 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

async function whole(page, testId, within) {
  const node = page.getByTestId(testId);
  await node.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await node.boundingBox();
  assert.ok(inside(box, within), `${testId} ${JSON.stringify(box)} leaves ${JSON.stringify(within)}`);
  const clipped = await node.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
  assert.equal(clipped, false, `${testId} is clipped`);
  return node;
}

async function theHeaderSaysItIsYourScratchpad({ page, url, viewport }) {
  await page.goto(url('scratchpad'));
  const pane = await page.getByTestId('scratchpad-chat').boundingBox();
  assert.ok(pane.x + pane.width <= viewport.width + 0.5, `the pane is ${pane.width}px wide in a ${viewport.width}px viewport`);
  const header = await (await whole(page, 'scratchpad-header', pane)).boundingBox();
  assert.equal(await (await whole(page, 'scratchpad-title', header)).innerText(), 'Scratchpad');
  assert.equal(await (await whole(page, 'scratchpad-line', header)).innerText(), LINE);
  assert.equal(await (await whole(page, 'scratchpad-stored', header)).innerText(), 'Stored on this device');
  const icon = await page.getByTestId('scratchpad-header').locator('svg').first().boundingBox();
  assert.ok(icon !== null && icon.width >= 12 && inside(icon, header), 'the notebook is not drawn in the header');
}

async function nothingSaysSomeoneIsThere({ page, url }) {
  await page.goto(url('scratchpad'));
  await page.locator('[data-message-id]').first().waitFor({ state: 'visible', timeout: 10_000 });
  const pane = page.getByTestId('scratchpad-chat');
  const drawn = async (selector) => pane.locator(selector).count();
  assert.equal(await drawn('[aria-label*="call" i], [data-testid*="call" i]'), 0, 'a call control is drawn');
  assert.equal(await drawn('[data-testid*="presence"], [data-testid*="typing"], [data-testid*="online"], [data-testid*="connection"]'), 0, 'a presence, typing or connection line is drawn');
  assert.equal(await drawn('[data-testid="message-status-sent"], [data-testid="message-status-delivered"], [data-testid="message-status-read"]'), 0, 'a delivery tick is drawn');
  assert.equal(await drawn('[data-testid="message-status-pending"]'), 1, 'the note still saving does not say so');
  assert.equal(await page.getByTestId('p2p-chat').count(), 0, 'the direct chat is mounted');
}

async function theEmptyScratchpadSaysWhatItIsFor({ page, url }) {
  await page.goto(url('scratchpad-empty'));
  const log = await page.getByTestId('scratchpad-chat-view').boundingBox();
  const empty = page.getByTestId('scratchpad-chat-view').getByText(LINE, { exact: true });
  await empty.waitFor({ state: 'visible', timeout: 10_000 });
  assert.ok(inside(await empty.boundingBox(), log), 'the empty line is not inside the transcript');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `the page scrolls sideways by ${overflow}px`);
}

async function theScratchpadIsReadable({ page, url }) {
  for (const scenario of ['scratchpad', 'scratchpad-empty']) {
    await page.goto(url(scenario));
    await page.getByTestId('scratchpad-header').waitFor({ state: 'visible', timeout: 10_000 });
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="scratchpad-chat"]').withRules(['color-contrast']).analyze();
    const failures = violations.flatMap((v) => v.nodes.map((n) => n.target.join(' ')));
    assert.equal(failures.length, 0, `${scenario}: ${failures.join(' | ')}`);
  }
}

export const SCRATCHPAD_CHECKS = { theHeaderSaysItIsYourScratchpad, nothingSaysSomeoneIsThere, theEmptyScratchpadSaysWhatItIsFor, theScratchpadIsReadable };
