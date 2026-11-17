import { strict as assert } from 'node:assert';

/**
 * A node channel's files, measured: the shared-file card (a file and a picture; downloading;
 * refused), the upload strip (storing, shared, refused) and the composer's destination line. At
 * 375px (the narrowest phone this app is laid out for) and on a desktop, under Full and Lite motion:
 * nothing leaves the viewport or scrolls sideways, no text is clipped, nothing overlaps the composer
 * or its neighbour, and every control is a 44px target. Boxes, never innerText, which cannot see
 * clipping or overlap.
 */
const MIN_TARGET = 44;

/**
 * Every finite animation has finished. An infinite one (the header's typing pulse under Full
 * motion, a busy spinner) never does by design, and is opacity or rotation, not layout, so it is
 * not waited on; checks-controls' `settled` waits on all of them and would time out here.
 */
const settled = (page) => page.waitForFunction(() => document.getAnimations()
  .every((a) => a.playState === 'finished' || a.playState === 'idle' || a.effect?.getComputedTiming().iterations === Infinity), undefined, { timeout: 5000 });
const MOTIONS = ['full', 'lite'];
const SLACK = 0.5;
const UPLOAD_NAME = 'Quarterly-engine-telemetry-export-for-every-boiler-and-turbine-in-the-plant.csv';

const overlaps = (a, b) => a.x < b.x + b.width - SLACK && b.x < a.x + a.width - SLACK && a.y < b.y + b.height - SLACK && b.y < a.y + a.height - SLACK;
const inside = (inner, outer) => inner.x >= outer.x - SLACK && inner.y >= outer.y - SLACK
  && inner.x + inner.width <= outer.x + outer.width + SLACK && inner.y + inner.height <= outer.y + outer.height + SLACK;
const show = (b) => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`;

async function measured(locator, label) {
  await locator.waitFor({ state: 'visible' });
  const box = await locator.boundingBox();
  assert.ok(box, `${label} has no box`);
  return box;
}

function aTarget(box, label) {
  assert.ok(box.width >= MIN_TARGET && box.height >= MIN_TARGET, `${label} is a ${show(box)} target, under ${MIN_TARGET}px`);
}

/** Text that wraps inside its box: anything wider or taller than the box is clipped or overflows. */
async function notClipped(locator, label) {
  const { sw, cw, sh, ch } = await locator.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
  assert.ok(sw <= cw + 1 && sh <= ch + 1, `${label} is clipped: content ${sw}x${sh} in a ${cw}x${ch} box`);
}

async function inTheViewport(page, box, width, label) {
  assert.ok(box.x >= -SLACK && box.x + box.width <= width + SLACK, `${label} ${show(box)} leaves the ${width}px viewport`);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(sideways <= 0, `the page scrolls sideways by ${sideways}px`);
}

/** Runs `measure` at 375px or the desktop width, once under Full motion and once under Lite. */
const atEachMotion = (scenario, measure) => async ({ page, url, viewport }) => {
  const width = viewport.width < 600 ? 375 : viewport.width;
  await page.setViewportSize({ width, height: viewport.height });
  try {
    for (const motion of MOTIONS) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(url(scenario));
      if (motion === 'lite') await page.evaluate(() => document.documentElement.classList.add('lite-motion'));
      await page.getByTestId('group-message-input').waitFor({ state: 'visible' });
      try { await measure(page, width); } catch (error) { throw new Error(`[${motion} motion, ${width}px] ${error.message}`); }
    }
  } finally {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize(viewport);
  }
};

const card = (page, name) => page.getByTestId('server-file').filter({ hasText: name });

/** A card's boxes, read in one frame: the transcript may scroll between two separate reads. */
const cardBoxes = (file) => file.evaluate((el) => {
  const rect = (node) => (node === null ? null : node.getBoundingClientRect().toJSON());
  return {
    box: rect(el), name: rect(el.querySelector('p')), button: rect(el.querySelector('[data-testid="server-file-download"]')),
    picture: rect(el.querySelector('[data-testid="server-file-picture"]')), alert: rect(el.querySelector('[role="alert"]')),
  };
});

async function cardFits(page, width, file, label) {
  await file.waitFor({ state: 'visible' });
  const boxes = await cardBoxes(file);
  const { box, name, button } = boxes;
  await inTheViewport(page, box, width, label);
  await notClipped(file.locator('p').first(), `${label}'s name`);
  aTarget(button, `${label}'s Download`);
  assert.ok(inside(button, box), `${label}'s Download ${show(button)} overhangs the card ${show(box)}`);
  assert.ok(!overlaps(name, button), `${label}'s name ${show(name)} runs under its Download ${show(button)}`);
  return boxes;
}

async function theSharedFileCardsFit(page, width) {
  const picture = page.getByTestId('server-file-picture');
  await picture.waitFor({ state: 'visible' });
  await picture.evaluate((img) => img.decode());
  await settled(page);
  await cardFits(page, width, card(page, 'Engine-room'), 'the PDF card');
  const pictured = await cardFits(page, width, card(page, 'boiler.png'), 'the picture card');
  const drawn = pictured.picture;
  assert.ok(drawn !== null && drawn.width > 0 && drawn.height > 0, 'the picture is not drawn');
  assert.ok(inside(drawn, pictured.box), `the picture ${show(drawn)} overhangs its card ${show(pictured.box)}`);
  const both = await page.getByTestId('server-file').evaluateAll((all) => all.map((el) => el.getBoundingClientRect().toJSON()));
  assert.equal(both.length, 2, `two cards expected, found ${both.length}`);
  assert.ok(!overlaps(both[0], both[1]), `the two cards overlap: ${show(both[0])} and ${show(both[1])}`);
}

/** Busy, Download keeps its place in its card (relative to the card: the transcript itself may scroll). */
async function aDownloadingFileKeepsItsPlace(page, width) {
  const file = card(page, 'Engine-room');
  await settled(page);
  const offset = ({ box, button }) => ({ x: button.x - box.x, y: button.y - box.y });
  const before = offset(await cardBoxes(file));
  await file.getByTestId('server-file-download').click();
  await page.locator('[data-testid="server-file-download"][disabled]').waitFor({ state: 'visible' });
  const after = offset(await cardFits(page, width, file, 'the downloading card'));
  assert.ok(Math.abs(after.x - before.x) <= SLACK && Math.abs(after.y - before.y) <= SLACK, `Download moved within its card from ${JSON.stringify(before)} to ${JSON.stringify(after)} once busy`);
}

async function aRefusedDownloadSaysWhy(page, width) {
  const file = card(page, 'Engine-room');
  await file.getByTestId('server-file-download').click();
  const alert = file.getByRole('alert');
  await alert.getByText('You cannot share or open files in this channel.').waitFor({ state: 'visible' });
  const { box, button, alert: said } = await cardFits(page, width, file, 'the refused card');
  await notClipped(alert, 'the refusal');
  assert.ok(inside(said, box), `the refusal ${show(said)} overhangs its card ${show(box)}`);
  assert.ok(!overlaps(said, button), `the refusal ${show(said)} runs under Download ${show(button)}`);
}

/** The strip and the composer below it share no pixel, and the strip fits the viewport unclipped. */
async function stripFits(page, width, state) {
  const strip = page.locator(`[data-testid="server-upload"][data-upload-state="${state}"]`);
  const box = await measured(strip, `the ${state} strip`);
  await inTheViewport(page, box, width, `the ${state} strip`);
  for (const p of await strip.locator('p').all()) await notClipped(p, `a line of the ${state} strip`);
  for (const [label, locator] of [
    ['the composer', page.getByTestId('group-message-input')],
    ['Send file', page.getByRole('button', { name: 'Send file' })],
    ['the destination line', page.getByTestId('attach-destination')],
  ]) {
    const other = await measured(locator, label);
    assert.ok(!overlaps(box, other), `the ${state} strip ${show(box)} covers ${label} ${show(other)}`);
  }
  return { strip, box };
}

const upload = (page) => page.getByTestId('group-file-input').setInputFiles({ name: UPLOAD_NAME, mimeType: 'text/csv', buffer: Buffer.alloc(1024 * 1024, 7) });

async function anUploadShowsWhatIsStored(page, width) {
  await upload(page);
  const bar = page.getByRole('progressbar', { name: `Upload of ${UPLOAD_NAME}` });
  await page.locator('[role="progressbar"][aria-valuenow="50"]').waitFor({ state: 'visible' });
  await settled(page);
  const { box } = await stripFits(page, width, 'uploading');
  const drawn = await measured(bar, 'the progress bar');
  assert.ok(inside(drawn, box), `the progress bar ${show(drawn)} overhangs the strip ${show(box)}`);
  const fill = await bar.locator('div').first().boundingBox();
  assert.ok(Math.abs(fill.width - drawn.width / 2) <= 1, `half stored draws a fill of ${fill.width}px in a ${drawn.width}px bar`);
  assert.match(await page.getByTestId('server-upload-announced').textContent(), /50 percent uploaded/);
}

const anUploadEnds = (state, said) => async (page, width) => {
  await upload(page);
  const { strip, box } = await stripFits(page, width, state);
  await strip.getByText(said).waitFor({ state: 'visible' });
  const dismiss = await measured(strip.getByTestId('server-upload-dismiss'), 'Dismiss');
  aTarget(dismiss, 'Dismiss');
  assert.ok(inside(dismiss, box), `Dismiss ${show(dismiss)} overhangs the strip ${show(box)}`);
  for (const p of await strip.locator('p').all()) {
    const line = await p.boundingBox();
    assert.ok(!overlaps(line, dismiss), `a line ${show(line)} runs under Dismiss ${show(dismiss)}`);
  }
  await strip.getByTestId('server-upload-dismiss').click();
  await page.getByTestId('server-upload').waitFor({ state: 'detached' });
};

async function theDestinationLineFits(page, width) {
  await settled(page);
  const line = page.getByTestId('attach-destination');
  const box = await measured(line, 'the destination line');
  assert.equal(await line.textContent(), "Stored on the workspace server, readable by this channel's members");
  await inTheViewport(page, box, width, 'the destination line');
  await notClipped(line, 'the destination line');
  for (const [label, locator] of [
    ['Send file', page.getByRole('button', { name: 'Send file' })],
    ['Send message', page.getByRole('button', { name: 'Send message' })],
    ['the composer', page.getByTestId('group-message-input')],
  ]) {
    const other = await measured(locator, label);
    assert.ok(!overlaps(box, other), `the destination line ${show(box)} runs into ${label} ${show(other)}`);
    if (label !== 'the composer') aTarget(other, label);
  }
}

export const SERVER_FILE_CHECKS = {
  theSharedFileCardsFit: atEachMotion('server-files', theSharedFileCardsFit),
  aDownloadingFileKeepsItsPlace: atEachMotion('server-files', aDownloadingFileKeepsItsPlace),
  aRefusedDownloadSaysWhy: atEachMotion('server-files-refusing', aRefusedDownloadSaysWhy),
  anUploadShowsWhatIsStored: atEachMotion('server-files', anUploadShowsWhatIsStored),
  aSharedUploadSaysSo: atEachMotion('server-files-sharing', anUploadEnds('shared', `Shared ${UPLOAD_NAME} with the channel`)),
  aRefusedUploadSaysWhy: atEachMotion('server-files-refusing', anUploadEnds('refused', 'Files in this channel can be at most 10 MB.')),
  theDestinationLineFits: atEachMotion('server-files', theDestinationLineFits),
};
