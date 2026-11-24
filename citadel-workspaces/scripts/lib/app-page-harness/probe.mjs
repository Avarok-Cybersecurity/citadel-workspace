/**
 * What check-app-page.mjs reads off the harness page (main.tsx `window.__page`) and the DOM, and
 * how it waits: on conditions, each with a deadline, never for a fixed time. A wait that runs out
 * returns false and the assertion that needed it fails, printing what the page showed instead.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** The transcript copy and its sidecar; throws when the copy is not the recorded bytes. */
export function loadTranscript(fixtureUrl, sourceUrl) {
  const bytes = readFileSync(fixtureUrl);
  const source = JSON.parse(readFileSync(sourceUrl, 'utf8'));
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== source.sha256) {
    throw new Error(`fixtures/joined.json is not the transcript recorded at ${source.repository}@${source.commit}: sha256 ${sha}, recorded ${source.sha256}`);
  }
  return { transcript: JSON.parse(bytes.toString('utf8')), source, sha };
}

/** A pass/fail ledger: each line says what was asserted and what was seen. */
export function ledger() {
  const state = { failures: 0, passes: 0, failed: [] };
  const check = (ok, what) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (ok) state.passes++;
    else {
      state.failures++;
      state.failed.push(what);
    }
    return ok;
  };
  return { state, check };
}

/** Waits for `fn(arg)` in the page to be truthy; false when `ms` runs out. `fn` must be synchronous. */
export async function until(page, fn, arg, ms = 15_000) {
  return page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);
}

/**
 * `until` for a predicate that takes time (it compares two reads apart): evaluated again until it
 * resolves truthy; false when `ms` runs out. Not `waitForFunction`: it takes the Promise an async
 * predicate returns as its truthy answer, so such a wait passed after one sample, whatever it saw.
 */
export async function untilAsync(page, fn, arg, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await page.evaluate(fn, arg)) return true;
  }
  return false;
}

export const record = (page) => page.evaluate(() => {
  const p = window.__page;
  return JSON.parse(JSON.stringify({ agent: p.agent, server: p.server, notices: p.notices, worker: p.worker, openNode: p.openNode }));
});

/** The region overlay's elements: role, accessible name and rectangle, in DOM (tab) order. */
export const regions = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="app-region-overlay"] > *')].map((el) => {
  const r = el.getBoundingClientRect();
  return { role: el.getAttribute('role'), label: el.getAttribute('aria-label'), id: el.dataset.regionId, x: r.x, y: r.y, w: r.width, h: r.height };
}));

/** The region rectangles, once two reads 150 ms apart agree to the pixel (the tree's springs have come to rest). */
export async function settledRegions(page, ms = 10_000) {
  const ok = await untilAsync(page, async () => {
    const read = () => [...document.querySelectorAll('[data-testid="app-region-overlay"] > *')].map((el) => el.getAttribute('style')).join('|');
    const a = read();
    await new Promise((r) => setTimeout(r, 150));
    return a !== '' && read() === a;
  }, undefined, ms);
  return { settled: ok, list: await regions(page) };
}

/** The app has stopped asking for frames: the host delivered none for 500 ms (the tree's movement is over, as the app sees it). */
export const framesStopped = (page, ms = 10_000) => untilAsync(page, async () => {
  const a = window.__page.worker.frames;
  await new Promise((r) => setTimeout(r, 500));
  return window.__page.worker.frames === a;
}, undefined, ms);

/** Every message the agent delivered has reached the app and every event the host sent it is done. */
export const idle = (page, ms) => until(page, () => window.__page.agent.inFlight === 0 && window.__page.worker.pendingEvents === 0, undefined, ms);

/** `want` ⊆ `got` as multisets; the labels missing from `got`, as a list. */
export function missingFrom(got, want) {
  const left = [...got];
  const missing = [];
  for (const w of want) {
    const at = left.indexOf(w);
    if (at < 0) missing.push(w);
    else left.splice(at, 1);
  }
  return missing;
}

export async function box(locator) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error('an element measured here is not laid out');
  return b;
}

export const within = (a, b, px) => Math.abs(a.x - b.x) <= px && Math.abs(a.y - b.y) <= px && Math.abs(a.width - b.width) <= px && Math.abs(a.height - b.height) <= px;
export const fmt = (b) => `${b.width.toFixed(1)}x${b.height.toFixed(1)}@${b.x.toFixed(1)},${b.y.toFixed(1)}`;
