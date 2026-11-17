import { strict as assert } from 'node:assert';

/** A dialog is measured at rest: mid-animation its box is the scaled, translated frame. */
const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
const overlaps = (a, b) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

async function targetsAreTouchSized(buttons, where) {
  const boxes = [];
  for (let i = 0; i < await buttons.count(); i += 1) {
    const box = await buttons.nth(i).boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `${where}: button ${i} is ${box.width}x${box.height} (needs 44x44)`);
    for (const other of boxes) assert.ok(!overlaps(box, other), `${where}: button ${i} ${JSON.stringify(box)} overlaps ${JSON.stringify(other)}`);
    boxes.push(box);
  }
}

/**
 * The viewer fits the screen at both widths: the dialog in the viewport, the picture inside its
 * stage at fit, every control a 44px target that covers no other. The arrow key moves on, and a
 * zoom past fit scrolls inside the stage rather than spilling out of it. Esc closes it.
 */
async function thePictureViewerFitsTheScreen({ page, url, viewport }) {
  await page.goto(url('picture-viewer'));
  const viewer = page.getByTestId('picture-viewer');
  await viewer.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Download' }).and(page.locator(':enabled')).waitFor({ timeout: 5000 });
  await settled(page);
  const dialog = await viewer.boundingBox();
  assert.ok(inside(dialog, { x: 0, y: 0, ...viewport }), `the viewer ${JSON.stringify(dialog)} leaves the ${viewport.width}px viewport`);
  const stage = await page.getByTestId('picture-viewer-stage').boundingBox();
  const picture = await page.getByTestId('picture-viewer-image').boundingBox();
  assert.ok(inside(picture, stage), `at fit the picture ${JSON.stringify(picture)} leaves its stage ${JSON.stringify(stage)}`);
  assert.ok(Math.abs(picture.width / picture.height - 2) < 0.05, `fit changed the picture's shape: ${picture.width}x${picture.height}`);
  await targetsAreTouchSized(page.getByRole('toolbar', { name: 'Picture controls' }).getByRole('button'), 'viewer toolbar');
  assert.match(await viewer.textContent(), /2 of 3/);
  await viewer.press('ArrowRight');
  await page.getByRole('heading', { name: 'pier.png' }).waitFor({ timeout: 3000 });
  for (let i = 0; i < 6; i += 1) await viewer.press('+');
  const zoomed = await viewer.boundingBox();
  assert.ok(inside(zoomed, { x: 0, y: 0, ...viewport }), `zoomed in, the viewer ${JSON.stringify(zoomed)} leaves the viewport`);
  await page.keyboard.press('Escape');
}

/** A picture in its bubble sits inside the bubble and the viewport, at a size that reads as a picture. */
async function aPictureSitsInItsBubble({ page, url, viewport }) {
  await page.goto(url('picture-bubble'));
  const picture = page.getByRole('button', { name: 'View sunset.png full size' });
  await picture.waitFor({ state: 'visible' });
  const box = await picture.boundingBox();
  const bubble = await page.getByTestId('file-transfer-bubble').boundingBox();
  assert.ok(inside(box, bubble), `the picture ${JSON.stringify(box)} leaves its bubble ${JSON.stringify(bubble)}`);
  assert.ok(box.x + box.width <= viewport.width, `the picture leaves the ${viewport.width}px viewport`);
  assert.ok(box.width >= 120 && box.height >= 100, `the picture is a ${box.width}x${box.height} postage stamp`);
}

/** The first-offer question fits a phone, its two answers are 44px targets, and its directions show. */
async function theAlwaysAcceptQuestionFits({ page, url, viewport }) {
  await page.goto(url('always-accept'));
  const dialog = page.getByTestId('always-accept-dialog');
  await dialog.waitFor({ state: 'visible' });
  await settled(page);
  assert.ok(inside(await dialog.boundingBox(), { x: 0, y: 0, ...viewport }), 'the question leaves the viewport');
  const directions = await page.getByTestId('always-accept-directions').boundingBox();
  assert.ok(inside(directions, await dialog.boundingBox()), 'the directions leave the dialog');
  await targetsAreTouchSized(dialog.getByRole('button').filter({ hasText: /Always accept|Ask me/ }), 'always-accept answers');
  for (const testid of ['always-accept-no', 'always-accept-yes']) {
    const answer = dialog.getByTestId(testid);
    const box = await answer.boundingBox();
    assert.ok(inside(box, await dialog.boundingBox()), `${testid} ${JSON.stringify(box)} leaves the dialog`);
    // The box alone is not reach: a button clipped by the dialog's overflow keeps its box, and a
    // click at its centre lands on the overlay. Ask what a click there would hit.
    const hit = await answer.evaluate((el, at) => el.contains(document.elementFromPoint(at.x, at.y)), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    assert.ok(hit, `a click at the centre of ${testid} does not reach it`);
  }
}

export const CHAT_FILE_CHECKS = { thePictureViewerFitsTheScreen, aPictureSitsInItsBubble, theAlwaysAcceptQuestionFits };
