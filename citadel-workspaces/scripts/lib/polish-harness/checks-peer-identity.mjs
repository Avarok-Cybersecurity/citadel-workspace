import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';

/** A dialog is measured at rest: mid-animation its box is the scaled, translated frame. */
const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
const overlaps = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

async function accessible(page, where) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  assert.equal(blocking.length, 0, `${where}: ${blocking.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join(' | ')}`);
}

async function noSidewaysScroll(page, viewport, where) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(width <= viewport.width, `${where}: the page is ${width}px wide in a ${viewport.width}px viewport`);
}

/** Every button a separate target of at least `min` px that a click at its centre reaches. */
async function targets(buttons, min, where) {
  const boxes = [];
  for (let i = 0; i < await buttons.count(); i += 1) {
    const button = buttons.nth(i);
    const box = await button.boundingBox();
    assert.ok(box.width >= min && box.height >= min, `${where}: button ${i} is ${box.width}x${box.height} (needs ${min}x${min})`);
    for (const other of boxes) assert.ok(!overlaps(box, other), `${where}: button ${i} overlaps another`);
    const hit = await button.evaluate((el, at) => el.contains(document.elementFromPoint(at.x, at.y)), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    assert.ok(hit, `${where}: a click at the centre of button ${i} does not reach it`);
    boxes.push(box);
  }
}

/** The mark sits in the header beside the status, inside the viewport, and opens the safety number. */
async function theMarkFitsTheHeader({ page, url, viewport }) {
  for (const [scenario, text] of [['peer-identity-verified', 'Verified'], ['peer-identity-unverified', 'Unverified']]) {
    await page.goto(url(scenario));
    const mark = page.getByTestId('peer-identity-mark');
    await mark.waitFor({ state: 'visible' });
    assert.match(await mark.textContent(), new RegExp(text));
    const box = await mark.boundingBox();
    assert.ok(inside(box, { x: 0, y: 0, ...viewport }), `${scenario}: the mark ${JSON.stringify(box)} leaves the viewport`);
    await targets(page.getByTestId('peer-identity-mark'), 24, `${scenario} mark`);
    await noSidewaysScroll(page, viewport, scenario);
    await accessible(page, scenario);
    await mark.click();
    const dialog = page.getByTestId('peer-safety-number');
    await dialog.waitFor({ state: 'visible' });
    await settled(page);
    assert.ok(inside(await dialog.boundingBox(), { x: 0, y: 0, ...viewport }), `${scenario}: the safety number leaves the viewport`);
    await accessible(page, `${scenario} safety number`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  }
}

/** The changed-key screen opens on its own, fits a phone, shows both keys, and its two answers are 44px targets. */
async function theChangedKeyScreenFits({ page, url, viewport }) {
  await page.goto(url('peer-identity-changed'));
  const dialog = page.getByTestId('peer-key-changed');
  await dialog.waitFor({ state: 'visible' });
  await settled(page);
  const frame = await dialog.boundingBox();
  assert.ok(inside(frame, { x: 0, y: 0, ...viewport }), `the screen ${JSON.stringify(frame)} leaves the ${viewport.width}px viewport`);
  for (const testid of ['peer-key-previous', 'peer-key-presented']) {
    assert.ok(inside(await dialog.getByTestId(testid).boundingBox(), frame), `${testid} leaves the screen`);
  }
  await targets(dialog.getByRole('button'), 44, 'changed-key answers');
  await noSidewaysScroll(page, viewport, 'changed-key screen');
  await accessible(page, 'changed-key screen');
}

export const PEER_IDENTITY_CHECKS = { theMarkFitsTheHeader, theChangedKeyScreenFits };
