/**
 * The owner's picture scenario on the shipped host (harness `?pictures=reopen`), measured on the
 * page canvas's pixels: a picture inserted through Insert › Picture is painted, and after the
 * document is closed and reopened in a fresh editor it is painted again in the same place, with
 * its own proportions. While its fetch is held the place shows a box and never the picture, and
 * the picture replaces the box once it arrives; a store that refuses leaves a box, never the
 * picture. The picture is one flat colour no page draws otherwise, so its pixels are its own.
 */

/** 4:3, one colour: magenta, which nothing else on a page is painted in. */
const PICTURE = { width: 240, height: 180 };
/** What counts as the picture's pixel (screen colour management shifts magenta a little). */
const MAGENTA = { minRed: 200, maxGreen: 70, minBlue: 200 };
/** Layout snaps to device pixels; a picture painted in the same place moves by under a pixel. */
const SAME_PLACE_PX = 1.5;
const PAINT_TIMEOUT_MS = 30_000;

async function pictureBytes(page) {
  const b64 = await page.evaluate(async ({ width, height }) => {
    const c = new OffscreenCanvas(width, height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, width, height);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }, PICTURE);
  return Buffer.from(b64, 'base64');
}

/** The first page canvas's pixels as the screen shows them, in CSS px, and where the picture's are. */
async function measure(page) {
  const canvas = page.locator('canvas[data-layer="page"]').first();
  const box = await canvas.boundingBox();
  const png = await canvas.screenshot({ scale: 'css' });
  return page.evaluate(async ({ b64, box, magenta }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const i = 4 * (y * img.width + x);
      if (d[i] > magenta.minRed && d[i + 1] < magenta.maxGreen && d[i + 2] > magenta.minBlue) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return { n, canvas: { width: img.width, height: img.height }, at: n === 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, page: box, rgba: Array.from(d), stride: img.width };
  }, { b64: png.toString('base64'), box, magenta: MAGENTA });
}

/** How many distinct colours the region `at` of a measurement holds: a drawn box has more than the bare page's one. */
function inks(m, at) {
  const seen = new Set();
  for (let y = at.y; y < at.y + at.height; y++) for (let x = at.x; x < at.x + at.width; x++) {
    const i = 4 * (y * m.stride + x);
    seen.add(`${m.rgba[i] >> 4},${m.rgba[i + 1] >> 4},${m.rgba[i + 2] >> 4}`);
  }
  return seen.size;
}

async function until(page, what, ok) {
  const deadline = Date.now() + PAINT_TIMEOUT_MS;
  for (;;) {
    const m = await measure(page);
    if (ok(m)) return m;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await page.waitForTimeout(100);
  }
}

const sameRect = (a, b) => ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) <= SAME_PLACE_PX);

async function reopen(page) {
  const before = await page.locator('canvas[data-layer="page"]').first().elementHandle();
  await page.evaluate(() => window.docsHarnessReopen());
  await page.waitForFunction((old) => !old.isConnected, before, { timeout: PAINT_TIMEOUT_MS });
  await page.locator('canvas[data-layer="page"]').first().waitFor({ timeout: PAINT_TIMEOUT_MS });
}

/** `scheme`: 'light' or 'dark'; `check(ok, what)` records a result. */
export async function picturesSurviveReopen(browser, engine, viewport, scheme, origin, check) {
  const context = await browser.newContext({ viewport, colorScheme: scheme });
  const page = await context.newPage();
  const label = `${engine}, ${viewport.name}, ${scheme}`;
  try {
    await page.goto(`${origin}/?pictures=reopen`);
    if (scheme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.locator('canvas[data-layer="page"]').first().waitFor({ timeout: 60_000 });
    await page.getByTestId('docs-ribbon-tab-insert').click();
    await page.getByTestId('ribbon-picture-file').setInputFiles({ name: 'picture.png', mimeType: 'image/png', buffer: await pictureBytes(page) });
    const inserted = await until(page, 'the inserted picture', (m) => m.n > 0);
    const at = inserted.at;
    check(Math.abs(at.width / at.height - PICTURE.width / PICTURE.height) < 0.03, `${label}: the inserted picture is painted with its own proportions (${at.width}x${at.height})`);
    check(inserted.n >= 0.95 * at.width * at.height, `${label}: it is painted whole, not a box's outline (${inserted.n} of ${at.width * at.height} px)`);
    check(at.x >= 0 && at.y >= 0 && at.x + at.width <= inserted.canvas.width && at.y + at.height <= inserted.canvas.height, `${label}: it lies on the page`);

    await reopen(page);
    const again = await until(page, 'the picture after reopening', (m) => m.n > 0);
    check(sameRect(again.at, at), `${label}: after reopening, the picture is painted again in the same place (${JSON.stringify(again.at)})`);

    await page.evaluate(() => window.docsHarnessPictures.hold());
    await reopen(page);
    const held = await until(page, 'the loading box', (m) => inks(m, at) > 1);
    check(held.n === 0, `${label}: while it is fetched, the picture is not painted (${held.n} px)`);
    check(inks(held, at) > 1, `${label}: its place shows a box while it is fetched`);
    await page.evaluate(() => window.docsHarnessPictures.release());
    const arrived = await until(page, 'the picture once released', (m) => m.n > 0);
    check(sameRect(arrived.at, at), `${label}: once it arrives the picture replaces the box, in the same place`);

    await page.evaluate(() => window.docsHarnessPictures.fail({ kind: 'notPermitted' }));
    await reopen(page);
    const refused = await until(page, 'the not-available box', (m) => inks(m, at) > 1);
    await page.waitForTimeout(500);
    const settled = await measure(page);
    check(refused.n === 0 && settled.n === 0, `${label}: a store that refuses leaves a box, never the picture (${settled.n} px)`);
  } finally {
    await page.evaluate(() => window.docsHarnessPictures?.fail(null)).catch(() => undefined);
    await context.close();
  }
}
