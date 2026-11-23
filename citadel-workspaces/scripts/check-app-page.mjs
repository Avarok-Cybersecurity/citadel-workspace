/**
 * An installed synchronized.work app opened as a node's full-pane page, in a real browser on the shipped runtime, with the member's agent holding its session and a recorded join arriving as one host notification (acceptance A8).
 *
 * lib/app-page-harness mounts the committed module and manifest through AppPagePane and the page
 * runtime (`mountPage`), the real worker, the real `citadel.session` port and the real notify path;
 * the one double is the agent at its socket, playing the transcript recorded from the real
 * synchronized.work node (fixtures/joined.json, refused unless its sha256 is the recorded one).
 * At desktop 1x and at 390x844 2x, each from a fresh page:
 *
 *  1. it runs as the page, told so, as the transcript's member on its node: the canvas and its
 *     host fill the pane, with no document chrome;
 *  2. a first run shows the link screen, its field reachable by Tab and visibly focused;
 *  3. the link code typed and Enter make the app send exactly the recorded redeem;
 *  4. the catch-up draws the tree: the recorded labels, inside the pane, laid out, no egress;
 *  5. the agent holds the session: one open, and after a reload a second open answered with the
 *     same account, on which the app greets and subscribes again and redeems nothing;
 *  6. the recorded join is ONE notification (its NOTIFY delivered twice), from the app, with the
 *     recorded words, whose card opens the app's node; at rest after it the tree names the recorded labels;
 *  7. the live page: every region named, axe finds nothing serious.
 *
 * Offline: every request the page makes goes to the harness's own server, or the check fails.
 */
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveHarness } from './lib/docs-harness/serve.mjs';
import { ledger, loadTranscript } from './lib/app-page-harness/probe.mjs';
import { catchUpDrawsTheTree, mountsAsAPage, showsTheLinkScreen, typingTheCodeRedeems } from './lib/app-page-harness/checks-page.mjs';
import { theAgentHoldsTheSession, theJoinIsOneNotification, theLivePageIsAccessible } from './lib/app-page-harness/checks-session.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'lib', 'app-page-harness');
const VIEWPORTS = [
  { name: 'desktop 1x', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  { name: 'phone 390x844 2x', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
];

const started = Date.now();
const { transcript, source } = loadTranscript(resolve(ROOT, 'fixtures', 'joined.json'), resolve(ROOT, 'fixtures', 'joined.source.json'));
const { state, check } = ledger();

async function flow(browser, origin, v) {
  const context = await browser.newContext({ viewport: v.viewport, deviceScaleFactor: v.deviceScaleFactor });
  const page = await context.newPage();
  const foreign = [];
  const sockets = [];
  const errors = [];
  page.on('request', (r) => { if (!r.url().startsWith(`${origin}/`)) foreign.push(r.url()); });
  page.on('websocket', (ws) => sockets.push(ws.url()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  await page.goto(`${origin}/`);
  if (await mountsAsAPage(page, v.name, check, transcript)) {
    await showsTheLinkScreen(page, v.name, check);
    await typingTheCodeRedeems(page, v.name, check, transcript);
    await catchUpDrawsTheTree(page, v.name, check, transcript);
    await theAgentHoldsTheSession(page, v.name, check, transcript);
    await theJoinIsOneNotification(page, v.name, check, transcript);
    await theLivePageIsAccessible(page, v.name, check);
  }
  const host = new URL(origin).host;
  const away = sockets.filter((u) => new URL(u).host !== host);
  check(foreign.length === 0 && away.length === 0, `${v.name}: offline: every request stayed on the harness's server (${foreign.length + away.length} left it${foreign.length + away.length ? `: ${[...foreign, ...away].slice(0, 3).join(', ')}` : ''}; ${sockets.length} socket attempt(s) to its own /ws, the page's own agent socket finding no agent)`);
  check(errors.length === 0, `${v.name}: no uncaught page error${errors.length ? ` (${errors.slice(0, 3).join(' | ')})` : ''}`);
  await context.close();
  return Date.now() - t0;
}

const harness = await serveHarness(ROOT);
const browser = await chromium.launch();
const timings = [];
try {
  for (const v of VIEWPORTS) timings.push(`${v.name} ${((await flow(browser, harness.origin, v)) / 1000).toFixed(1)}s`);
} finally {
  await browser.close();
  await harness.close();
}
if (state.failures > 0) {
  console.error(`\n${state.failures} of ${state.failures + state.passes} app page check(s) failed:\n${state.failed.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`\nAll ${state.passes} app page checks passed: ${VIEWPORTS.length} viewports, ${transcript.steps.length} recorded steps and ${transcript.tail.length} tail steps from ${source.repository.split('/').pop()}@${source.commit.slice(0, 7)} (${timings.join(', ')}; ${((Date.now() - started) / 1000).toFixed(1)}s in all).`);
