/**
 * The CPU counters stall-attribution.mjs judges, read over CDP (Chromium only): the tab's main-thread CPU
 * (Performance.getMetrics ThreadTime) and the renderer and GPU processes' CPU (SystemInfo.getProcessInfo).
 * Read before and after a sample, never during it, so the reads cost the motion nothing.
 */
import { usableCounters } from './stall-attribution.mjs';

const PROBE_READS = 300;
const RUN = new WeakMap();

/** Milliseconds of CPU so far: the tab's main thread, and every renderer and GPU process. */
async function readCounters(browserCdp, tabCdp) {
  const metrics = (await tabCdp.send('Performance.getMetrics')).metrics;
  const thread = metrics.find((m) => m.name === 'ThreadTime');
  if (thread === undefined) throw new Error('Performance.getMetrics reported no ThreadTime');
  const processes = (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
  const byType = (type) => new Map(processes.filter((p) => p.type === type).map((p) => [p.id, p.cpuTime * 1000]));
  return { main: thread.value * 1000, renderer: byType('renderer'), gpu: byType('GPU') };
}

/** after - before; a process only counts while it lives through both reads. */
function delta(before, after) {
  const sum = (a, b) => [...b].reduce((s, [id, ms]) => s + (a.has(id) ? ms - a.get(id) : 0), 0);
  return { main: after.main - before.main, renderer: sum(before.renderer, after.renderer), gpu: sum(before.gpu, after.gpu) };
}

/**
 * Each counter's step in ms on this machine, from back-to-back reads while a page both runs script and
 * repaints a blurred layer (so the GPU process has work), or null for a counter that never advanced.
 */
async function resolution(browser, origin) {
  const context = await browser.newContext();
  try {
    const tab = await context.newPage();
    const tabCdp = await context.newCDPSession(tab);
    await tabCdp.send('Performance.enable');
    const browserCdp = await browser.newBrowserCDPSession();
    await tab.goto(`${origin}/?s=focused-sidebar&theme=light&motion=full&sel=flex`);
    await tab.evaluate(() => {
      const layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;filter:blur(40px);opacity:.02;background:repeating-radial-gradient(circle,#000 0 2px,transparent 2px 5px)';
      document.body.appendChild(layer);
      let n = 0;
      const spin = () => { layer.style.transform = `rotate(${++n}deg)`; requestAnimationFrame(spin); };
      requestAnimationFrame(spin);
      setInterval(() => { const end = performance.now() + 8; while (performance.now() < end) { /* busy */ } }, 10);
    });
    const steps = { main: [], renderer: [], gpu: [] };
    let last = await readCounters(browserCdp, tabCdp);
    for (let i = 0; i < PROBE_READS; i++) {
      const now = await readCounters(browserCdp, tabCdp);
      const d = { main: now.main - last.main, renderer: maxStep(last.renderer, now.renderer), gpu: maxStep(last.gpu, now.gpu) };
      for (const c of Object.keys(steps)) if (d[c] > 0) steps[c].push(d[c]);
      last = now;
    }
    await browserCdp.detach();
    return Object.fromEntries(Object.entries(steps).map(([c, xs]) => [c, xs.length === 0 ? null : +Math.min(...xs).toFixed(3)]));
  } finally {
    await context.close();
  }
}
/** The step of whichever process of a type moved (one tab's renderer, the one GPU process). */
const maxStep = (a, b) => Math.max(0, ...[...b].map(([id, ms]) => (a.has(id) ? ms - a.get(id) : 0)));

/**
 * The run's attribution: usableCounters() over the measured steps, measured once per browser. Null where
 * nothing can be attributed (not Chromium, or CPU throttling, which CDP counts as CPU time).
 */
export async function attributionFor(browser, origin, throttle) {
  if (browser.browserType().name() !== 'chromium' || throttle > 1) return null;
  if (!RUN.has(browser)) {
    const steps = await resolution(browser, origin);
    const usable = usableCounters(steps);
    console.log(`        stall attribution: counter steps ${Object.entries(steps).map(([c, s]) => `${c} ${s === null ? 'none' : `${s} ms`}`).join(', ')}; ${usable.counters === null ? usable.reason : `judging with ${usable.counters.join(', ')}`}`);
    RUN.set(browser, usable);
  }
  return RUN.get(browser);
}

/** Opens a fresh tab, brings it to rest, and samples one transition with the counters read around it. */
export async function measuredSample(context, { open, sample, counted }) {
  const tab = await context.newPage();
  try {
    const tabCdp = counted ? await context.newCDPSession(tab) : null;
    if (tabCdp) await tabCdp.send('Performance.enable');
    await open(tab);
    if (!tabCdp) return { frames: await sample(tab), counters: null };
    const browserCdp = await context.browser().newBrowserCDPSession();
    try {
      const before = await readCounters(browserCdp, tabCdp);
      const frames = await sample(tab);
      return { frames, counters: delta(before, await readCounters(browserCdp, tabCdp)) };
    } finally {
      await browserCdp.detach();
    }
  } finally {
    await tab.close();
  }
}
