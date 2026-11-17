/**
 * Citadel Docs text is as sharp as the screen allows, measured in a real browser on pixels.
 *
 * Serves the shipped DocumentHost (lib/docs-harness), types a line into a blank document at
 * devicePixelRatio 1 and 2, screenshots the first line in device pixels and measures every ink
 * edge (lib/docs-harness/edges.mjs). The browser composites a canvas at its CSS size, so a page
 * canvas of fractional CSS size (793.5 px for an odd 2x width) is rescaled by a pixel across the
 * page and every edge softens: the blur this guards. Every page canvas must also sit on whole
 * device pixels, with the host shifted by a fractional CSS offset as the app's layout can shift
 * it.
 *
 * The reference is the page canvas's own pixels before the browser composites them: what the
 * engine's rasteriser drew, read back from the canvas. Only the main-thread renderer's canvas
 * can be read (a worker's OffscreenCanvas cannot), so each DPR first runs with that renderer (as
 * a browser without transferControlToOffscreen does) to take the reference, then both renderers
 * are measured against it. The rasteriser is the same code in both, so any edge the screen shows
 * softer than the canvas holds was softened by placement or compositing. (The browser's own
 * fillText was the reference before; it measures the platform's text rasteriser instead: Linux
 * hints stems to the pixel grid and macOS does not, so its edges differ by OS for the same page.)
 *
 *   CRISPNESS_OUT=<dir>   also writes each crop as <dir>/dpr<N>-offset<X>.png
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveDocsHarness } from './lib/docs-harness/serve.mjs';
import { grayscale, measureEdges } from './lib/docs-harness/edges.mjs';

const PORT = Number(process.env.DOCS_HARNESS_PORT ?? 4198);
const TEXT = 'Illumination lit HIH minimum';
/** Mean pixels per edge strictly between 10% and 90% of the step, at most (the owner's bar). */
const LIMIT = { 1: 1.5, 2: 2 };
/**
 * And no softer than the canvas's own pixels by more than this, edge for edge. The owner's bar
 * alone passed the blur it was set for (a 2x page at 793.5 CSS px measured 1.42 across and 1.97
 * down); a resampled canvas adds about half a pixel per edge.
 */
const OVER_REFERENCE = 0.25;
const RENDERERS = ['main-thread', 'worker'];
const OFFSETS = [0, 0.3];
const OUT = process.env.CRISPNESS_OUT ?? null;

async function pixels(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { width: img.width, height: img.height, rgba: Array.from(ctx.getImageData(0, 0, img.width, img.height).data) };
  }, png.toString('base64'));
}

async function measure(page, png) {
  const { width, height, rgba } = await pixels(page, png);
  return measureEdges(grayscale(rgba, width, height), width, height);
}

/**
 * The first page canvas's own pixels under `clip` (CSS px, page coordinates), read back from the
 * canvas: what the rasteriser drew, before the browser places and composites it.
 */
async function canvasPixels(page, clip) {
  const { width, height, rgba } = await page.evaluate((clip) => {
    const canvas = document.querySelector('[data-testid="document-page"][data-page="0"] canvas[data-layer="page"]');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no first page canvas');
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / r.width;
    const [x, y, w, h] = [clip.x - r.left, clip.y - r.top, clip.width, clip.height].map((v) => Math.round(v * k));
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('the page canvas has no 2D context to read (is this the worker renderer?)');
    return { width: w, height: h, rgba: Array.from(ctx.getImageData(x, y, w, h).data) };
  }, clip);
  return measureEdges(grayscale(rgba, width, height), width, height);
}

/** Every page-view canvas whose screen rect does not start and end on whole device pixels. */
async function misplacedCanvases(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid="document-page"] canvas')].flatMap((el) => {
    const r = el.getBoundingClientRect();
    const d = window.devicePixelRatio;
    const edges = [r.left * d, r.top * d, r.right * d, r.bottom * d];
    const off = edges.some((v) => Math.abs(v - Math.round(v)) > 0.01);
    return off ? [`${el.dataset.layer ?? el.getAttribute('aria-label') ?? 'canvas'} at device (${edges.map((v) => v.toFixed(2)).join(', ')})`] : [];
  }));
}

async function crop(page) {
  const box = await page.locator('[data-testid="document-page"][data-page="0"]').boundingBox();
  if (box === null) throw new Error('the first page is not laid out');
  // One inch in (the blank document's margins at 100% zoom): the first line's ascenders to
  // descenders, short of where the line ends, so the caret after it is not measured.
  return { x: box.x + 90, y: box.y + 90, width: 150, height: 40 };
}

async function typedLine(page, dpr) {
  await page.locator('canvas[data-layer="page"]').first().waitFor({ timeout: 60_000 });
  await page.keyboard.type(TEXT);
  const clip = await crop(page);
  // Settled: two screenshots a quarter second apart are the same pixels, and hold text.
  let previous = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const png = await page.screenshot({ clip });
    if (previous !== null && png.equals(previous)) {
      try {
        return { png, edges: await measure(page, png) };
      } catch {
        // Not painted yet: keep waiting.
      }
    }
    previous = png;
    await page.waitForTimeout(250);
  }
  throw new Error(`dpr ${dpr}: the typed line never settled into painted text`);
}

async function run(browser, dpr, offset, renderer) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr });
  // A browser without transferControlToOffscreen gets the main-thread renderer (runtime.ts).
  if (renderer === 'main-thread') await context.addInitScript(() => { delete HTMLCanvasElement.prototype.transferControlToOffscreen; });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${harness.origin}/?offset=${offset}`);
  const { png, edges } = await typedLine(page, dpr);
  const own = renderer === 'main-thread' ? await canvasPixels(page, await crop(page)) : null;
  problems.push(...(await misplacedCanvases(page)).map((c) => `not on device pixels: ${c}`));
  await context.close();
  return { png, edges, own, problems };
}

const harness = await serveDocsHarness(PORT);
const browser = await chromium.launch();
let failures = 0;
try {
  if (OUT !== null) mkdirSync(OUT, { recursive: true });
  for (const dpr of [1, 2]) {
    let reference = null;
    for (const renderer of RENDERERS) {
      for (const offset of OFFSETS) {
        const { png, edges, own, problems } = await run(browser, dpr, offset, renderer);
        reference ??= own;
        if (reference === null) throw new Error('the main-thread run must come first: it reads the reference');
        if (OUT !== null) writeFileSync(join(OUT, `dpr${dpr}-${renderer}-offset${offset}.png`), png);
        const worst = Math.max(edges.across.mean, edges.down.mean);
        const softer = Math.max(edges.across.mean - reference.across.mean, edges.down.mean - reference.down.mean);
        const ok = worst <= LIMIT[dpr] && softer <= OVER_REFERENCE && problems.length === 0;
        if (!ok) failures++;
        console.log(`  ${ok ? 'ok  ' : 'FAIL'}  dpr ${dpr} ${renderer} offset ${offset}px: edge width across ${edges.across.mean} (p90 ${edges.across.p90}, ${edges.across.edges} edges), down ${edges.down.mean} (p90 ${edges.down.p90}); limit ${LIMIT[dpr]} and the canvas's own pixels + ${OVER_REFERENCE}: across ${reference.across.mean}, down ${reference.down.mean}${problems.length > 0 ? `; problems: ${problems.join(' | ')}` : ''}`);
      }
    }
  }
} finally {
  await browser.close();
  await harness.close();
}
process.exit(failures === 0 ? 0 : 1);
