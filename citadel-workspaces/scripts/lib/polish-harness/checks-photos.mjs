import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROOT } from './serve.mjs';

/**
 * A HEIC and a TIFF in the full-size viewer are drawn at their own size (naturalWidth from the
 * decoded picture, never a broken image), fit inside the stage keeping their shape, and offer
 * Download; a DNG whose orientation is stated in the DNG and in its preview's Exif is turned once
 * (each quadrant's colour where one turn puts it); a damaged HEIC says why and what to do, with
 * its controls, inside the stage, unclipped, and Download still saves it. Boxes, decoded sizes
 * and pixels, never innerText alone, which cannot see a broken or misturned image.
 *
 * The harness serves no public/: the decoder's binary is answered from the committed file at
 * the URL the worker asks for, for this context only.
 */
const WASM = readFileSync(join(APP_ROOT, 'public', 'photo', 'photo_decode_bg.wasm'));
const settled = (page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'), undefined, { timeout: 5000 });
const inside = (inner, outer) => inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;

async function drawnAt(page, name, width, height) {
  await page.getByRole('heading', { name }).waitFor({ timeout: 5000 });
  const image = page.getByTestId('picture-viewer-image');
  // The stage shows "Loading picture..." until this picture's load answers; then its own image.
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-testid="picture-viewer-image"]');
    return img !== null && img.complete && img.naturalWidth > 0 && !img.src.startsWith('data:');
  }, undefined, { timeout: 15_000 });
  const natural = await image.evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  assert.deepEqual(natural, [width, height], `${name} is drawn at ${natural.join('x')}, not its ${width}x${height}`);
  await settled(page);
  const stage = await page.getByTestId('picture-viewer-stage').boundingBox();
  const box = await image.boundingBox();
  assert.ok(inside(box, stage), `${name} ${JSON.stringify(box)} leaves its stage ${JSON.stringify(stage)}`);
  assert.ok(Math.abs(box.width / box.height - width / height) < 0.05, `${name} lost its shape: ${box.width}x${box.height}`);
  await page.getByTestId('picture-viewer-download').and(page.locator(':enabled')).waitFor({ timeout: 3000 });
}

/** The drawn picture's colour at each quadrant's centre, read from its decoded pixels. */
async function quadrants(page) {
  return page.getByTestId('picture-viewer-image').evaluate((img) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const at = (fx, fy) => Array.from(ctx.getImageData(Math.floor(img.naturalWidth * fx), Math.floor(img.naturalHeight * fy), 1, 1).data.slice(0, 3));
    return { topLeft: at(0.25, 0.25), topRight: at(0.75, 0.25), bottomLeft: at(0.25, 0.75), bottomRight: at(0.75, 0.75) };
  });
}

const near = (got, want) => got.every((c, i) => Math.abs(c - want[i]) <= 48);
const COLOUR = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255] };

/** Red, green, blue, white (top-left, top-right, bottom-left, bottom-right) turned 90 degrees clockwise once. */
async function turnedOnce(page, name) {
  const got = await quadrants(page);
  const want = { topLeft: 'blue', topRight: 'red', bottomLeft: 'white', bottomRight: 'green' };
  for (const [corner, colour] of Object.entries(want)) {
    assert.ok(near(got[corner], COLOUR[colour]), `${name} is not turned once: ${corner} is ${got[corner].join(',')}, not ${colour} (${JSON.stringify(got)})`);
  }
}

async function photosAreDrawnInTheViewer({ page, url, viewport }) {
  await page.context().route('**/photo/photo_decode_bg.wasm', (route) => route.fulfill({ body: WASM, contentType: 'application/wasm' }));
  await page.goto(url('photo-viewer'));
  const viewer = page.getByTestId('picture-viewer');
  await viewer.waitFor({ state: 'visible' });
  assert.ok(inside(await viewer.boundingBox(), { x: 0, y: 0, ...viewport }), `the viewer leaves the ${viewport.width}px viewport`);
  await drawnAt(page, 'IMG_0001.HEIC', 64, 64);
  await viewer.press('ArrowRight');
  await drawnAt(page, 'scan.tif', 48, 48);
  await viewer.press('ArrowRight');
  await drawnAt(page, 'turned.dng', 48, 48);
  await turnedOnce(page, 'turned.dng');
  await viewer.press('ArrowRight');
  await page.getByRole('heading', { name: 'damaged.heic' }).waitFor({ timeout: 5000 });
  const why = page.getByTestId('picture-viewer-stage').getByText(/^This picture cannot be shown: it could not be read as a photo/);
  await why.waitFor({ timeout: 15_000 });
  const stage = await page.getByTestId('picture-viewer-stage').boundingBox();
  assert.ok(inside(await why.boundingBox(), stage), 'the reason a damaged photo is not shown leaves the stage');
  const clipped = await why.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  assert.ok(!clipped, 'the reason a damaged photo is not shown is clipped');
  // Its way on is a control in the stage, and the file is still the file: Download saves it.
  const ok = page.getByTestId('picture-viewer-stage').getByRole('button', { name: 'OK' });
  await ok.waitFor({ timeout: 3000 });
  assert.ok(inside(await ok.boundingBox(), stage), 'the damaged photo\'s OK leaves the stage');
  await page.getByTestId('picture-viewer-download').and(page.locator(':enabled')).waitFor({ timeout: 3000 });
  await page.context().unroute('**/photo/photo_decode_bg.wasm');
}

export const PHOTO_CHECKS = { photosAreDrawnInTheViewer };
