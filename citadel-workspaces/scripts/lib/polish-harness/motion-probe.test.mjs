import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roughness } from './motion-probe.mjs';

// One drawn box, the shape motion-sampler.mjs returns: frame 0 is stamped as the click lands, the rest by framer's clock.
const box = (shown) => ({ shown, shownTop: 100, opacity: 1, inkTop: 100, ink: shown, row: false, scored: true, el: 0 });
const framesOf = (times, series) => times.map((t, i) => ({ t, 'box:stack': box(series[i]) }));
const settle = (times, series, until = 26) => {
  const [t, s] = [[...times], [...series]];
  while (t.length < until) { t.push(t[t.length - 1] + (t[t.length - 1] - t[t.length - 2])); s.push(s[s.length - 1]); }
  return [t, s];
};
const jumps = (times, series) => roughness(framesOf(...settle(times, series))).jump;

// tree-motion's GLIDE, cubic-bezier(0.2, 0, 0, 1) over MOTION_SECONDS.layout, sampled at `frameMs` from `startMs`.
function glide(frameMs, { from, to, startMs, stallAtMs = -1, stallMs = 0, count = 26 }) {
  const x = (s) => 3 * (1 - s) ** 2 * s * 0.2 + s ** 3;
  const y = (s) => 3 * (1 - s) * s ** 2 + s ** 3;
  const progress = (u) => { let [lo, hi] = [0, 1]; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (x(m) < u) lo = m; else hi = m; } return y(lo); };
  const times = [0];
  for (let t = frameMs; times.length < count; t += frameMs) times.push(stallAtMs >= 0 && t > stallAtMs ? t + stallMs : t);
  const series = times.map((t) => from + (to - from) * progress(Math.min(1, Math.max(0, (t - startMs) / 220))));
  return [times, series];
}

test('a glide sampled at half rate is not a jump: its steep start lands in one frame (measured, WebKit)', () => {
  // room -> building, 1280px: steady ~33 ms frames, no paint gap; the second step carries the curve's steep start.
  assert.deepEqual(jumps([0, 34, 67, 100, 141, 167, 200, 234, 277, 300], [139.0, 133.7, 97.5, 80.8, 70.7, 67.2, 64.8, 64.0, 64.0, 64.0]), []);
  assert.deepEqual(jumps([0, 33, 66, 99, 133, 168, 200, 233, 266, 300], [204.5, 218.5, 271.2, 294.2, 306.6, 313.5, 316.6, 317.5, 317.5, 317.5]), []);
});

test('a glide whose first paint the commit held back is not a jump (measured: first frame at +55 ms)', () => {
  assert.deepEqual(jumps([0, 55, 65, 96, 138, 169, 197, 230, 264, 296], [416.0, 415.6, 413.1, 397.0, 387.6, 384.3, 382.5, 381.4, 381.0, 381.0]), []);
});

test('a real one-frame jump mid-glide is a jump, at half rate and at full rate', () => {
  const [slowT, slowS] = [[0, 34, 67, 100, 141, 167, 200, 234, 277, 300], [139.0, 133.7, 97.5, 80.8, 70.7, 67.2, 64.8, 64.0, 64.0, 64.0]];
  assert.equal(jumps(slowT, slowS.map((v, i) => (i >= 5 ? v - 30 : v))).length, 1);
  const [fastT, fastS] = glide(1000 / 60, { from: 139, to: 64, startMs: 17 });
  assert.equal(jumps(fastT, fastS.map((v, i) => (i >= 9 ? v - 30 : v))).length, 1);
});

test('a smooth glide at full rate, and one with a 165 ms main-thread stall, are not jumps', () => {
  assert.deepEqual(jumps(...glide(1000 / 60, { from: 139, to: 64, startMs: 17 })), []);
  assert.deepEqual(jumps(...glide(1000 / 60, { from: 139, to: 64, startMs: 17, stallAtMs: 85, stallMs: 165 })), []);
  assert.deepEqual(jumps(...glide(1000 / 30, { from: 139, to: 64, startMs: 33, stallAtMs: 67, stallMs: 165 })), []);
});
