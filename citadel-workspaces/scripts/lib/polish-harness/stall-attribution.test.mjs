import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attribute, baselineOf, ceilingProblem, judgeTransition, longestGap, MAX_ATTEMPTS, usableCounters } from './stall-attribution.mjs';

// Frames every 11 ms, optionally with one long gap: the shape motion-sampler.mjs returns (only `t` matters here).
const frames = (gapAt = -1, gap = 0) => Array.from({ length: 60 }, (_, i) => ({ t: i * 11 + (gapAt >= 0 && i > gapAt ? gap - 11 : 0) }));
const c = ([main, renderer, gpu]) => ({ main, renderer, gpu });
// Measured on the Linux runner (diagnostic run 45576666698), `room -> sibling room`: process counters move in 10 ms.
const RUNNER = usableCounters({ main: 0.038, renderer: 10, gpu: 10 });
// The GPU counter reads one tick every sample: sd 0, so without a tick floor any one tick more would be "the page".
const CLEAN = [[109, 170, 10], [106, 180, 10], [112, 170, 10], [108, 190, 10], [110, 160, 10], [107, 175, 10]];
const BUSY = c([215, 268, 8]);
const PAUSED = c([98, 155, 20]); // the GPU read one tick high: the sample the 2 sd rule alone blamed on the page
const RASTER = c([83, 308, 345]);
const clean = (i) => ({ frames: frames(), counters: c(CLEAN[i % CLEAN.length]) });
const stall = (counters) => ({ frames: frames(3, 130), counters });
const feed = (...samples) => { let i = 0; return async () => { if (i >= samples.length) throw new Error('measured too often'); return samples[i++]; }; };
const smooth = () => [];
const five = [0, 1, 2, 3, 4].map(clean);

test('the longest gap and where it starts', () => {
  assert.deepEqual(longestGap(frames(3, 127)), { gap: 127, at: 33 });
});

test('a clean first sample is judged once and nothing more is measured', async () => {
  assert.deepEqual(await judgeTransition(feed(clean(0)), () => ['jump'], RUNNER), { problems: ['jump'], discarded: 0, notes: [] });
});

test('a page busy loop during the stall is red and never re-measured past its baseline', async () => {
  const out = await judgeTransition(feed(stall(BUSY), ...five), smooth, RUNNER);
  assert.equal(out.discarded, 0);
  assert.match(out.problems[0], /did not paint for 130 ms .* while the page worked: main 215/);
});

test('raster work the page caused is red', async () => {
  const out = await judgeTransition(feed(stall(RASTER), ...five), smooth, RUNNER);
  assert.match(out.problems[0], /renderer 308.*gpu 345/);
});

test('a paused renderer is discarded, even with the GPU one 10 ms tick high, and the verdict is the clean samples', async () => {
  const out = await judgeTransition(feed(stall(PAUSED), ...five), smooth, RUNNER);
  assert.deepEqual(out.problems, []);
  assert.equal(out.discarded, 1);
  assert.match(out.notes[0], /^discarded: the page did not paint for 130 ms/);
});

test('every clean sample must pass the motion rule, not only the first', async () => {
  let n = 0;
  const out = await judgeTransition(feed(stall(PAUSED), ...five), () => (++n === 4 ? ['jump 84px'] : []), RUNNER);
  assert.deepEqual(out.problems, ['jump 84px']);
});

test('stalls on every attempt are red, with the reason', async () => {
  const out = await judgeTransition(feed(...Array(MAX_ATTEMPTS).fill(stall(PAUSED))), smooth, RUNNER);
  assert.match(out.problems[0], /^stalled in 8 of 8 attempts: the page did not paint for 130 ms/);
});

test('too few clean samples within the cap is red, never a discard', async () => {
  const s = [stall(PAUSED), clean(0), stall(PAUSED), clean(1), stall(PAUSED), clean(2), stall(PAUSED), clean(3)];
  const out = await judgeTransition(feed(...s), smooth, RUNNER);
  assert.match(out.problems[0], /^stalled in 4 of 8 attempts/);
  assert.equal(out.discarded, 0);
});

test('where nothing can be attributed a stalled sample keeps its verdict and is named', async () => {
  for (const attribution of [null, usableCounters({ main: 0.04, renderer: null, gpu: 10 })]) {
    const out = await judgeTransition(feed({ frames: frames(3, 127), counters: null }), () => ['jump 78px'], attribution);
    assert.deepEqual(out.problems, ['jump 78px']);
    assert.match(out.notes[0], /not attributable here/);
  }
});

test('a counter coarser than 20 ms or that never advances is left out; without main or renderer attribution is off', () => {
  assert.deepEqual(usableCounters({ main: 0.04, renderer: 10, gpu: null }).counters, ['main', 'renderer']);
  assert.deepEqual(usableCounters({ main: 0.04, renderer: 10, gpu: 25 }).counters, ['main', 'renderer']);
  assert.match(usableCounters({ main: 0.04, renderer: 30, gpu: 10 }).reason, /stall attribution off: renderer moves in 30 ms steps/);
  assert.match(usableCounters({ main: null, renderer: 10, gpu: 10 }).reason, /main does not advance/);
});

test('the allowance is max(2 ticks, min(2 sd, gap / 4)) above the mean', () => {
  const base = baselineOf(CLEAN.slice(0, 5).map(c), RUNNER.counters);
  const at = (gpu, ticks = RUNNER.ticks) => attribute({ ...c([108, 170, gpu]), gap: 130 }, base, ticks).by;
  const twoTicks = base.gpu.mean + 20; // 2 ticks (20) over 2 sd (0)
  assert.equal(at(twoTicks), 'runner');
  assert.equal(at(twoTicks + 0.01), 'page');
  const fine = { main: 0.04, renderer: 0.03, gpu: 0.001 }; // a fine clock: the sd term decides
  assert.equal(at(base.gpu.mean + 2 * base.gpu.sd - 0.01, fine), 'runner');
  assert.equal(at(base.gpu.mean + 2 * base.gpu.sd + 0.01, fine), 'page');
});

test('a baseline needs five clean samples', () => {
  assert.throws(() => baselineOf(CLEAN.slice(0, 4).map(c), RUNNER.counters), /needs 5/);
});

test('the sweep ceiling', () => {
  assert.deepEqual(ceilingProblem(3, 36), []);
  assert.match(ceilingProblem(4, 36)[0], /4 of 36 transitions/);
});
