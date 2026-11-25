/**
 * The focused sidebar, measured in a real engine: row heights, target sizes, the tree's ARIA and
 * contrast, and that a selection GLIDES -- a row that changes list is sampled every frame and must
 * pass through positions between where it was and where it lands. jsdom has no layout and no frames,
 * so none of this can be asserted there.
 */
import { strict as assert } from 'node:assert';
import { AxeBuilder } from '@axe-core/playwright';
import { settled, targetsAreBigEnough } from './checks-controls.mjs';
import { ROUGH, roughness } from './motion-probe.mjs';
import { sampleTransition } from './motion-sampler.mjs';
import { ceilingProblem, judgeTransition } from './stall-attribution.mjs';
import { attributionFor, measuredSample } from './stall-counters.mjs';
import { cpuThrottle, newParityContext } from '../ci-parity.mjs';

const MOBILE_BELOW = 768;
const within = (actual, expected) => Math.abs(actual - expected) <= 0.5;

/** Design heights at the app's 14px root; phones get touch rows (44, and 34 in the stack). */
async function focusedRowsHaveTheirHeights({ page, url, viewport }) {
  const phone = viewport.width < MOBILE_BELOW;
  await page.goto(url('focused-sidebar') + '&sel=eng');
  await page.getByRole('tree').waitFor({ state: 'visible' });
  await settled(page);
  const height = async (testid) => (await page.getByTestId(testid).boundingBox()).height;
  const expect = { 'tree-node-workspace-root': phone ? 34 : 30, 'tree-node-berlin': phone ? 34 : 24, 'tree-node-eng': phone ? 44 : 30, 'tree-node-flex': phone ? 44 : 28, 'add-child-row-eng': phone ? 44 : 26 };
  for (const [testid, px] of Object.entries(expect)) {
    const h = await height(testid);
    assert.ok(within(h, px), `${testid} is ${h}px tall (expected ${px})`);
  }
}

/** The tree is a tree to assistive tech, and its text is readable on the stack's tint and the sidebar. */
async function focusedTreeIsATree({ page, url }) {
  await page.goto(url('focused-sidebar') + '&sel=eng');
  await page.getByRole('tree').waitFor({ state: 'visible' });
  await page.getByTestId('tree-node-toggle-design').click();
  await page.getByTestId('tree-node-crit').waitFor({ state: 'visible' });
  await settled(page);
  const { violations } = await new AxeBuilder({ page }).include('[role="tree"]')
    .withRules(['color-contrast', 'aria-required-children', 'aria-required-parent', 'nested-interactive', 'button-name', 'aria-allowed-attr', 'aria-valid-attr-value', 'list', 'listitem'])
    .analyze();
  const found = violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
  assert.equal(found.length, 0, found.slice(0, 6).join(' | '));
}

/**
 * Every frame for `ms` after clicking `testid`, where that row's top edge is. The click is made in the
 * page so the first sample is the frame the change lands in, not one a round trip later.
 */
/**
 * Every frame for `ms` after clicking `clicked`, where each of `watched` has its top edge. The click is
 * made in the page so the first sample is the frame the change lands in, not one a round trip later.
 */
function sampleAfterClick(page, clicked, watched, ms) {
  return page.evaluate(async ({ id, ids, span }) => {
    const top = (t) => document.querySelector(`[data-testid="${t}"]`)?.getBoundingClientRect().top ?? null;
    const before = ids.map(top);
    document.querySelector(`[data-testid="${id}"]`).click();
    const samples = ids.map(() => []);
    const start = performance.now();
    await new Promise((done) => {
      const tick = () => {
        ids.forEach((t, i) => samples[i].push(top(t)));
        if (performance.now() - start < span) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    return ids.map((t, i) => ({ id: t, before: before[i], samples: samples[i] }));
  }, { id: clicked, ids: watched, span: ms });
}

const between = (v, a, b) => v !== null && v > Math.min(a, b) + 1 && v < Math.max(a, b) - 1;

/**
 * Selecting Engineering's child "Flex HQ" moves it from the child list to the sibling list and moves
 * Engineering into the stack. Whichever of the two travels further (it depends on the row heights,
 * so on the viewport) is the one measured: how many distinct positions it passed through on the way.
 */
async function glide(context, url, query) {
  const page = await context.newPage();
  try {
    await page.goto(url('focused-sidebar') + query);
    await page.getByTestId('tree-node-flex').waitFor({ state: 'visible' });
    await settled(page);
    const tracks = await sampleAfterClick(page, 'tree-node-flex', ['tree-node-flex', 'tree-node-eng'], 700);
    const travel = (t) => Math.abs((t.samples[t.samples.length - 1] ?? t.before) - t.before);
    const { id, before, samples } = tracks.sort((a, b) => travel(b) - travel(a))[0];
    const end = samples[samples.length - 1];
    assert.ok(end !== null && Math.abs(end - before) > 10, `no row moved (${id}: ${before} -> ${end}); the probe measures nothing`);
    return new Set(samples.filter((v) => between(v, before, end)).map((v) => Math.round(v))).size;
  } finally {
    await page.close();
  }
}

/** A row that changes list glides there; with reduced motion, or Animations off, it is simply there. */
async function aSelectionGlides({ page, url, viewport }) {
  const browser = page.context().browser();
  const moving = await newParityContext(browser, { viewport, reducedMotion: 'no-preference' });
  try {
    const frames = await glide(moving, url, '&sel=eng');
    assert.ok(frames >= 3, `the row jumped: ${frames} intermediate position(s) between where it was and where it landed`);
    const switchedOff = await glide(moving, url, '&sel=eng&anim=off');
    assert.equal(switchedOff, 0, `with Animations off the row still moved through ${switchedOff} position(s)`);
  } finally {
    await moving.close();
  }
  // This check's own page runs under reducedMotion: 'reduce' (see run-checks).
  const reduced = await glide(page.context(), url, '&sel=eng');
  assert.equal(reduced, 0, `under prefers-reduced-motion the row still moved through ${reduced} position(s)`);
}

/**
 * Selection changes that move rows between lists, sampled every frame for 800ms and scored by motion-probe:
 * nothing reverses, jumps, overlaps or snaps. The owner's report was a jump of more than one level, so those
 * lead (ascending by the stack's own rows, descending through `to=`, the way a link or search result selects);
 * one-level moves are the control that must stay smooth too.
 */
const LEVEL_CHANGES = [
  ['room -> workspace (5 levels up)', '&sel=flex', 'tree-node-workspace-root'],
  ['room -> building (3 levels up)', '&sel=flex', 'tree-node-alex'],
  ['floor -> city (2 levels up)', '&sel=floor3', 'tree-node-berlin'],
  ['workspace -> room (5 levels down)', '&sel=workspace-root&to=flex', 'harness-select'],
  ['city -> floor (2 levels down)', '&sel=berlin&to=floor3', 'harness-select'],
  ['office -> its room (1 down)', '&sel=eng', 'tree-node-flex'],
  ['room -> its office (1 up)', '&sel=flex', 'tree-node-eng'],
  ['room -> sibling room', '&sel=flex', 'tree-node-standup'],
  ['office -> sibling office', '&sel=eng', 'tree-node-design'],
];

/** POLISH_CPU_THROTTLE=4 (or CI_PARITY=1) slows Chromium's CPU the way a CI runner is slow, to reproduce what only CI sees. */
const THROTTLE = cpuThrottle();

/**
 * Every level change, sampled; `judge` turns one transition's findings into problems. A sample whose page did
 * not paint for FLOOR_MS is attributed, not judged (stall-attribution.mjs); `tally` counts what was discarded.
 */
async function eachLevelChange({ page, url, viewport }, { throttle, query: extra, judge, tally }) {
  if (throttle > 1 && page.context().browser().browserType().name() !== 'chromium') throw new Error('CPU throttling needs Chromium (CDP)');
  const moving = await newParityContext(page.context().browser(), { viewport, reducedMotion: 'no-preference' });
  const attribution = tally ? await attributionFor(moving.browser(), new URL(url('focused-sidebar')).origin, throttle) : null;
  const rough = [];
  try {
    for (const [name, query, clicked] of LEVEL_CHANGES) {
      const open = async (tab) => {
        if (throttle > 1) await (await moving.newCDPSession(tab)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
        await tab.goto(url('focused-sidebar') + query + extra);
        await tab.getByTestId(clicked).waitFor({ state: 'visible' });
        await settled(tab);
      };
      const counted = attribution !== null && attribution.counters !== null;
      const measure = () => measuredSample(moving, { open, sample: (tab) => sampleTransition(tab, clicked, 800), counted });
      const { problems, discarded, notes } = await judgeTransition(measure, judge, attribution);
      for (const n of notes) console.log(`        ${name}: ${n}`);
      if (counted) { tally.transitions += 1; tally.discarded += discarded; }
      if (problems.length > 0) rough.push(`${name}: ${problems.length} -- ${problems.slice(0, 3).join(' | ')}`);
    }
  } finally {
    await moving.close();
  }
  assert.equal(rough.length, 0, rough.join('\n        '));
}

/** Samples discarded as runner stalls, over the transitions where one could be: the sweep's ceiling. */
const STALLS = { discarded: 0, transitions: 0 };

async function aLevelChangeIsOneMotion(args) {
  await eachLevelChange(args, {
    throttle: THROTTLE,
    query: '',
    judge: (frames) => { const found = roughness(frames); return ROUGH.flatMap((k) => found[k].map((f) => `${k}: ${f.slice(0, 160)}`)); },
    tally: STALLS,
  });
}
aLevelChangeIsOneMotion.afterAll = () => ceilingProblem(STALLS.discarded, STALLS.transitions);

/** The CPU of a slow phone, which is what lite is for. CDP throttling is Chromium's; WebKit runs it unthrottled. */
const LITE_THROTTLE = 6;

/** A row that moves in lite is in its new place at once: any frame between the two is a glide still running. */
function glided(frames) {
  const tops = new Map();
  for (const f of frames) for (const [key, v] of Object.entries(f)) if (key.startsWith('row:') && v.opacity > 0.05) (tops.get(key) ?? tops.set(key, []).get(key)).push(v.shownTop);
  return [...tops].filter(([, s]) => s.some((v) => v > Math.min(s[0], s[s.length - 1]) + 1 && v < Math.max(s[0], s[s.length - 1]) - 1)).map(([key]) => `${key} glided`);
}

/** Lite on a slow CPU: nothing drawn over anything else at strength, and nothing glides (it is lite that ran). */
async function aLiteLevelChangeOverlapsNothing(args) {
  const engine = args.page.context().browser().browserType().name();
  await eachLevelChange(args, {
    throttle: engine === 'chromium' ? LITE_THROTTLE : 1,
    query: '&anim=lite',
    judge: (frames) => [...roughness(frames).overlap.map((f) => `overlap: ${f.slice(0, 160)}`), ...glided(frames)],
  });
}

/**
 * A workspace with no spaces still draws its root: on screen, inside the sidebar, at its design height,
 * and it takes a tap at its centre -- with its Add row beneath it. It was a sentence and nothing else.
 */
async function anEmptyWorkspaceShowsItsRoot({ page, url, viewport }) {
  const phone = viewport.width < MOBILE_BELOW;
  await page.goto(url('empty-sidebar'));
  const root = page.getByTestId('tree-node-workspace-root');
  await root.waitFor({ state: 'visible', timeout: 8000 });
  await settled(page);
  const box = await root.boundingBox();
  assert.ok(within(box.height, phone ? 44 : 36), `the root row is ${box.height}px tall (expected ${phone ? 44 : 36})`);
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height, `the root row is off screen: ${JSON.stringify(box)}`);
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="tree-node-workspace-root"]') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  assert.ok(hit, 'something else takes a tap at the root row\'s centre');
  const add = await page.getByTestId('add-child-row-workspace-root').boundingBox();
  assert.ok(add && within(add.height, phone ? 44 : 26), `the Add row under the root is ${add?.height}px tall (expected ${phone ? 44 : 26})`);
}

export const SIDEBAR_CHECKS = {
  anEmptyWorkspaceShowsItsRoot,
  focusedRowsHaveTheirHeights,
  focusedTreeIsATree,
  aSelectionGlides,
  aLevelChangeIsOneMotion,
  aLiteLevelChangeOverlapsNothing,
  targetsInTheFocusedSidebar: targetsAreBigEnough('focused-sidebar&sel=eng', '[role="tree"]'),
  targetsInTheEmptySidebar: targetsAreBigEnough('empty-sidebar', '[role="tree"]'),
};
