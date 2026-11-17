/**
 * The Docs pane's loading and save states, measured in a real browser on the shipped DocumentHost
 * (lib/docs-harness). jsdom has no layout, so none of this is visible to a unit test:
 *
 * Loading: while the engine's binary is held back (the request parked by route interception),
 * the editor region is never empty -- a sheet of A4's proportions sits centred in it with the
 * indicator over its first lines, nothing overflows sideways, and the region gives way to the page
 * canvas once the binary arrives. At desktop and phone width, under each motion tier: Lite swaps
 * the sweep for a breathe across the whole track (never a zeroed variable), Off draws it full.
 *
 * Save status: stepped through every state, the AutoSave switch and the Save button never move by
 * a pixel; the quiet "saved" state draws no words beside its icon, and every state that needs the
 * person draws its words; the title bar never scrolls sideways, at desktop or phone width, and on
 * a phone what a state offers (Try again; Sync or Discard) takes a row of its own under it.
 */
import { chromium } from 'playwright';
import { serveDocsHarness } from './lib/docs-harness/serve.mjs';

const PORT = Number(process.env.DOCS_HARNESS_PORT ?? 4199);
const VIEWPORTS = [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }];
const WASM = '**/cdoc/cdoc_wasm_editor_bg.wasm';
/** Sub-pixel: layout snaps to device pixels, and a control that moved has moved by whole pixels. */
const STILL_PX = 0.5;
/** Extra letter-spacing standing for a wider font than the dev machine's (CI's Linux face drew the status words ~12% wider). */
const WIDER_FACE_EM = 0.08;

const AT_REST = { autoSave: true, link: 'up', unacknowledged: 0, syncRequested: false, local: 'written', halted: false, locked: false };
const STATES = {
  saved: AT_REST,
  savedToDevice: { ...AT_REST, autoSave: false, unacknowledged: 3 },
  offline: { ...AT_REST, unacknowledged: 3, link: 'down' },
  refused: { ...AT_REST, unacknowledged: 3, halted: true },
  unsavedOnDevice: { ...AT_REST, unacknowledged: 3, local: 'failed' },
  locked: { ...AT_REST, locked: true },
};
const LOUD = ['offline', 'refused', 'unsavedOnDevice', 'locked'];
/** States with something to do (Try again; Sync or Discard): on a phone, a row of their own. */
const OFFERS = ['unsavedOnDevice', 'locked'];

let failures = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
}

const box = async (locator) => {
  const b = await locator.boundingBox();
  if (b === null) throw new Error('an element measured here is not laid out');
  return b;
};

async function loading(browser, viewport, tier) {
  const context = await browser.newContext({ viewport, reducedMotion: tier === 'os-reduce' ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(WASM, async (route) => { await held; await route.continue(); });
  await page.goto(`${harness.origin}/`);
  const pane = page.getByTestId('app-loading-pane');
  await pane.waitFor({ timeout: 60_000 });
  // The class motion-state.ts writes for Lite (Settings, or Auto on a slower device).
  if (tier === 'lite') await page.evaluate(() => document.documentElement.classList.add('lite-motion'));
  const label = `${viewport.name}, ${tier}`;
  const region = await box(page.getByTestId('document-editor-region'));
  const p = await box(pane);
  const sheet = await box(page.getByTestId('app-loading-sheet'));
  const card = await box(page.getByTestId('app-loading-card'));
  check(p.height >= region.height * 0.6, `${label}: the loading pane fills the editor region (${p.height.toFixed(0)} of ${region.height.toFixed(0)} px)`);
  check(Math.abs(sheet.x + sheet.width / 2 - (p.x + p.width / 2)) < 1, `${label}: the sheet is centred in the pane`);
  check(Math.abs(sheet.height / sheet.width - 297 / 210) < 0.01, `${label}: the sheet has A4's proportions (${(sheet.height / sheet.width).toFixed(3)})`);
  check(sheet.x >= p.x + 15 && sheet.x + sheet.width <= p.x + p.width - 15, `${label}: the sheet keeps a 16px gutter`);
  check(card.y > sheet.y && card.x >= sheet.x && card.x + card.width <= sheet.x + sheet.width, `${label}: the indicator sits over the sheet`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `${label}: nothing overflows sideways (${overflow}px)`);
  const fill = page.locator('[data-testid="app-loading-bar"] > div');
  // A tier's width change runs as a transition: measure where it ends, not mid-way.
  await fill.evaluate((el) => Promise.all(el.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)));
  const bar = await box(page.getByTestId('app-loading-bar'));
  const sweep = await fill.evaluate((el) => ({ name: getComputedStyle(el).animationName, width: el.getBoundingClientRect().width }));
  if (tier === 'full') check(sweep.name === 'app-loading-sweep' && sweep.width < bar.width * 0.5, `${label}: the indeterminate bar sweeps a segment (${sweep.name})`);
  if (tier === 'lite') check(sweep.name === 'app-loading-breathe' && Math.abs(sweep.width - bar.width) < 1, `${label}: Lite swaps the sweep for a full-width breathe (${sweep.name})`);
  if (tier === 'os-reduce') check(Math.abs(sweep.width - bar.width) < 1, `${label}: reduced motion draws the bar full width, never a frozen segment`);
  release();
  await page.locator('canvas[data-layer="page"]').first().waitFor({ timeout: 60_000 });
  check(await pane.count() === 0, `${label}: the pane gives way to the page once the engine arrives`);
  await context.close();
}

async function saveStates(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${harness.origin}/?save=controls`);
  // A narrower face than the one on this machine would hide a wrap that another platform's wider one shows: draw the words wider.
  await page.addStyleTag({ content: `html { letter-spacing: ${WIDER_FACE_EM}em; }` });
  await page.waitForFunction(() => typeof window.docsHarnessSaveInputs === 'function');
  const step = async (name) => {
    await page.evaluate((inputs) => window.docsHarnessSaveInputs(inputs), STATES[name]);
    await page.locator(`[data-testid="docs-save-status"][data-status="${name}"]`).waitFor({ timeout: 10_000 });
    return {
      autoSave: await box(page.getByTestId('docs-autosave')),
      save: await box(page.getByTestId('docs-save')),
      words: (await box(page.getByTestId('docs-save-status-label'))).width,
      header: await page.getByRole('banner').evaluate((el) => el.scrollWidth - el.clientWidth),
    };
  };
  const first = await step('saved');
  check(first.words <= 1, `${viewport.name}: "saved" draws its icon alone, no words beside it (${first.words}px)`);
  for (const name of Object.keys(STATES)) {
    const at = await step(name);
    const moved = Math.max(Math.abs(at.autoSave.x - first.autoSave.x), Math.abs(at.autoSave.y - first.autoSave.y), Math.abs(at.save.x - first.save.x), Math.abs(at.save.y - first.save.y));
    check(moved < STILL_PX, `${viewport.name}, ${name}: AutoSave and Save stay where they were (moved ${moved.toFixed(2)}px)`);
    check(at.header <= 0, `${viewport.name}, ${name}: the title bar does not scroll sideways (${at.header}px)`);
    if (LOUD.includes(name)) check(at.words > 20, `${viewport.name}, ${name}: says itself in words (${at.words.toFixed(0)}px)`);
    if (viewport.name === 'phone' && OFFERS.includes(name)) {
      const row = await box(page.getByTestId('docs-save-actions'));
      const bar = await box(page.getByRole('banner'));
      check(row.y >= at.save.y + at.save.height && row.y + row.height <= bar.y + bar.height, `${viewport.name}, ${name}: what it offers sits on its own row, under the controls, inside the title bar`);
    }
  }
  await context.close();
}

const harness = await serveDocsHarness(PORT);
const browser = await chromium.launch();
try {
  for (const viewport of VIEWPORTS) {
    console.log(`\nLoading pane, ${viewport.name}`);
    for (const tier of ['full', 'lite', 'os-reduce']) await loading(browser, viewport, tier);
    console.log(`\nSave status, ${viewport.name}`);
    await saveStates(browser, viewport);
  }
} finally {
  await browser.close();
  await harness.close();
}
console.log(failures === 0 ? '\nThe Docs pane states hold.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
