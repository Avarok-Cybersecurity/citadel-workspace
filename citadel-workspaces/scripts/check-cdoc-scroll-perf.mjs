/**
 * Scrolling a long Citadel Docs document never drops frames, measured in a real browser.
 *
 * Opens the 500-page benchmark document (lib/docs-harness/fixtures/500p.docx, the citadel-docs
 * bench corpus) in the shipped editor on the docs harness, then scrolls one viewport per frame
 * to the end, timing every frame.
 *
 * The gate is ONLYOFFICE's own measurement, like for like: on the same 2-vCPU GitHub runner
 * class, at 1x (no CPU throttling), its scroll held p95 16.8 ms with 5.3% of frames over a frame
 * (16.7 ms; 106 of 2016, hosted competitors run 39180201987, where ours measured p95 16.67 ms
 * and 1.0%). A pass fails past MAX_LONG (5%) long frames or past MAX_P95_MS (16.8 ms) p95. The limits hold
 * only at 1x: at any other rate the numbers are printed and nothing is gated, because a throttle
 * multiplies a CPU that differs from machine to machine (4x on a 2-vCPU runner measured 11.8%
 * long frames where 4x on a laptop measured 0.2%).
 *
 * After the gated pass, a second pass is traced (Chrome's own trace, nothing instrumented in the
 * page) and written per frame to SCROLL_FRAMES (default scroll-frames.json): its duration, the
 * main thread's and the workers' busy time, and the main thread's time by event. The gated pass
 * is never traced, since tracing costs frames.
 *
 *   SCROLL_THROTTLE=<rate>   CPU throttling for a local sensitivity run, e.g. 4 (default 1: the gate)
 *   SCROLL_FRAMES=<file>     where the traced pass's frames go
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { serveDocsHarness } from './lib/docs-harness/serve.mjs';
import { contrast, framesOf, FRAME_MARK, startTrace } from './lib/docs-harness/frame-trace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DOCS_HARNESS_PORT ?? 4199);
const DOC = join(HERE, 'lib/docs-harness/fixtures/500p.docx');
const THROTTLE = Number(process.env.SCROLL_THROTTLE ?? 1);
const FRAMES_OUT = process.env.SCROLL_FRAMES ?? 'scroll-frames.json';
/** One frame at 60 Hz; the share of frames allowed past it and the p95, ONLYOFFICE's at 1x. */
const FRAME_MS = 1000 / 60;
const MAX_LONG = 0.05;
const MAX_P95_MS = 16.8;
/** rAF deltas jitter around a vsync; a frame is long only when it misses one. */
const JITTER_MS = 1;
/**
 * A pass needs one frame per viewport; one that takes twice that has failed. It is something
 * pulling the view back (a caret reveal answered every viewport report once), and unbounded it
 * never ends.
 */
const SLACK = 2;

const isLong = (ms) => ms > FRAME_MS + JITTER_MS;

/** In the page: one viewport per frame to the end, marking each frame; resolves to the deltas. */
function scrollPass({ slack, mark }) {
  return new Promise((resolve, reject) => {
    const view = document.querySelector('[data-testid="page-view"]');
    if (!(view instanceof HTMLElement)) throw new Error('no page view');
    const max = slack * Math.ceil(view.scrollHeight / view.clientHeight);
    const deltas = [];
    let last = null;
    const step = (now) => {
      performance.mark(mark);
      if (last !== null) deltas.push(now - last);
      last = now;
      if (view.scrollTop + view.clientHeight >= view.scrollHeight - 1) return resolve(deltas);
      if (deltas.length > max) return reject(new Error(`no end after ${max} frames (at ${view.scrollTop} of ${view.scrollHeight}): something pulls the view back`));
      view.scrollBy(0, view.clientHeight);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

const harness = await serveDocsHarness(PORT);
const browser = await chromium.launch();
let ok = false;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route((url) => url.pathname === '/fixtures/500p.docx', (route) => route.fulfill({ body: readFileSync(DOC), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  await page.goto(`${harness.origin}/?doc=/fixtures/500p.docx`);
  const status = page.locator('[data-testid="docs-page-status"]');
  await status.filter({ hasText: /Page \d+ of \d{3}/ }).waitFor({ timeout: 180_000 });
  console.log('  opened');
  const total = Number((await status.innerText()).match(/of (\d+)/)[1]);
  if (total < 400) throw new Error(`the benchmark document laid out as ${total} pages, not about 500`);
  await page.locator('canvas[data-layer="page"]').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  console.log('  painted');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const frames = await page.evaluate(scrollPass, { slack: SLACK, mark: FRAME_MARK });
  const sorted = [...frames].sort((x, y) => x - y);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const long = frames.filter(isLong).length;
  const share = long / frames.length;
  const gated = THROTTLE === 1;
  ok = errors.length === 0 && (!gated || (share <= MAX_LONG && at(0.95) <= MAX_P95_MS));
  const verdict = !gated ? 'info' : ok ? 'ok  ' : 'FAIL';
  console.log(`  ${verdict}  ${total} pages, ${frames.length} frames at ${THROTTLE}x CPU throttling: median ${at(0.5).toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms (limit ${MAX_P95_MS}), max ${sorted[sorted.length - 1].toFixed(1)} ms; ${long} (${(100 * share).toFixed(1)}%) over ${FRAME_MS.toFixed(1)} ms, limit ${100 * MAX_LONG}%${gated ? '' : '; not gated: the limits are for 1x'}${errors.length > 0 ? `; page errors: ${errors.join(' | ')}` : ''}`);

  await page.evaluate(() => { document.querySelector('[data-testid="page-view"]').scrollTop = 0; });
  await page.waitForTimeout(1000);
  const stop = await startTrace(cdp);
  const traced = await page.evaluate(scrollPass, { slack: SLACK, mark: FRAME_MARK });
  const perFrame = framesOf(await stop());
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const c = contrast(perFrame, (f) => isLong(f.ms), 8);
  writeFileSync(FRAMES_OUT, JSON.stringify({ throttle: THROTTLE, gated: { frames, long, share }, traced: { long: traced.filter(isLong).length, frames: perFrame }, contrast: c }));
  const pair = ([l, r]) => `${l.toFixed(1)} / ${r.toFixed(1)}`;
  console.log(`  traced pass: ${c.long} of ${perFrame.length} frames long; mean ms per frame, long / other: main ${pair(c.mainBusy)}, workers ${pair(c.workerBusy)}`);
  for (const [k, l, r] of c.top) console.log(`    ${l.toFixed(2).padStart(7)} / ${r.toFixed(2).padEnd(7)} ${k}`);
  console.log(`  frames written to ${FRAMES_OUT}`);
} finally {
  await browser.close();
  await harness.close();
}
process.exit(ok ? 0 : 1);
