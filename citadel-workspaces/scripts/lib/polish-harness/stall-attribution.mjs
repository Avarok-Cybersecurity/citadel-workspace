/**
 * Whether a motion sample is evidence. Pure: no browser, no I/O (stall-counters.mjs reads the counters).
 *
 * A sample with a gap of FLOOR_MS or more between painted frames did not show the motion -- nothing was painted
 * for that long -- so it is not judged by the motion rules. It is attributed instead, against a baseline of the
 * same transition's clean samples from the same run (BASELINE_CLEAN of them, measured from fresh tabs, at most
 * MAX_ATTEMPTS samples in all). Each counter -- main-thread CPU, renderer CPU, GPU-process CPU -- may rise above
 * its baseline mean by max(2 of its measured ticks, min(2 sd, gap / 4)):
 *
 *   - none above: the page did no extra work while nothing painted, so the runner stalled it (descheduled,
 *     starved). The sample is INVALID: it is discarded, printed, and the verdict comes from the clean samples.
 *   - any above: the page itself was busy (script, layout, raster, compositing) while nothing painted -- jank a
 *     member would see. Red, named, never measured again.
 *
 * This is the re-measurement of an invalid sample, not a retry of a failed assertion: no sample with a long
 * frame is ever judged passing, every clean sample must pass the unchanged motion rules, the cap reached
 * without BASELINE_CLEAN clean samples is red, and discards above CEILING of a sweep's transitions are red.
 * Where the counters cannot be read or mean nothing -- WebKit, any CDP-throttled run (throttling is counted as
 * CPU), a counter coarser than MAX_TICK_MS or one that does not advance for the main thread or the renderer --
 * nothing is discarded: a stalled sample is judged as sampled, as before, and its stall is named.
 */
export const FLOOR_MS = 50;
export const BASELINE_CLEAN = 5;
export const MAX_ATTEMPTS = 8;
export const CEILING = 0.1;
/** A counter whose step is coarser than this cannot see a stall the size of FLOOR_MS. */
export const MAX_TICK_MS = 20;
export const COUNTERS = ['main', 'renderer', 'gpu'];
/** Without these two a busy page could pass for a stalled runner, so attribution is off. */
const REQUIRED = ['main', 'renderer'];

/** The longest interval between painted frames, and where it starts, in ms from the first frame. */
export function longestGap(frames) {
  let gap = 0;
  let at = 0;
  for (let i = 1; i < frames.length; i++) {
    const g = frames[i].t - frames[i - 1].t;
    if (g > gap) { gap = g; at = frames[i - 1].t - frames[0].t; }
  }
  return { gap, at };
}

/**
 * The counters this run can attribute with, from each counter's measured step in ms (null: it never advanced).
 * Returns { counters, ticks } or { counters: null, reason } when attribution is off for the run.
 */
export function usableCounters(steps) {
  const ticks = {};
  const dropped = [];
  for (const c of COUNTERS) {
    const step = steps[c];
    if (step === null || step === undefined) dropped.push(`${c} does not advance`);
    else if (step > MAX_TICK_MS) dropped.push(`${c} moves in ${step} ms steps`);
    else ticks[c] = step;
  }
  const missing = REQUIRED.filter((c) => !(c in ticks));
  if (missing.length > 0) return { counters: null, reason: `stall attribution off: ${dropped.join(', ')}` };
  return { counters: Object.keys(ticks), ticks, dropped };
}

/** Per counter: mean and sample standard deviation of the clean samples' deltas. */
export function baselineOf(clean, counters) {
  if (clean.length < BASELINE_CLEAN) throw new Error(`a baseline needs ${BASELINE_CLEAN} clean samples, got ${clean.length}`);
  return Object.fromEntries(counters.map((c) => {
    const xs = clean.map((s) => s[c]);
    if (xs.some((x) => !Number.isFinite(x))) throw new Error(`counter ${c} missing from a clean sample`);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
    return [c, { mean, sd }];
  }));
}

/** 'runner' when no counter rose above its allowance during the stall; otherwise 'page' and which rose. */
export function attribute(sample, base, ticks) {
  const over = Object.keys(base).flatMap((c) => {
    const allowance = base[c].mean + Math.max(2 * ticks[c], Math.min(2 * base[c].sd, sample.gap / 4));
    return sample[c] > allowance ? [`${c} ${Math.round(sample[c])} ms against ${Math.round(base[c].mean)} +- ${Math.round(base[c].sd)}`] : [];
  });
  return over.length === 0 ? { by: 'runner' } : { by: 'page', over };
}

export const stallWords = (s) => `the page did not paint for ${Math.round(s.gap)} ms at +${Math.round(s.at)} ms`;

/**
 * One transition. `measure()` takes a sample from a fresh tab: { frames, counters }, counters being
 * { main, renderer, gpu } deltas in ms. `judge(frames)` is the unchanged motion rule. `attribution` is
 * usableCounters()'s result, or null where this engine or run cannot attribute.
 * Returns { problems, discarded, notes }: problems empty is green; notes are printed whatever the verdict.
 */
export async function judgeTransition(measure, judge, attribution) {
  const first = await measure();
  const gap1 = longestGap(first.frames);
  if (gap1.gap < FLOOR_MS) return { problems: judge(first.frames), discarded: 0, notes: [] };
  if (attribution === null || attribution.counters === null) {
    return { problems: judge(first.frames), discarded: 0, notes: [`${stallWords(gap1)} (not attributable here: judged as sampled)`] };
  }
  const held = [{ ...first.counters, ...gap1 }];
  const clean = [];
  for (let attempt = 2; attempt <= MAX_ATTEMPTS && clean.length < BASELINE_CLEAN; attempt++) {
    const s = await measure();
    const g = longestGap(s.frames);
    if (g.gap >= FLOOR_MS) held.push({ ...s.counters, ...g });
    else clean.push(s);
  }
  if (clean.length < BASELINE_CLEAN) {
    return { problems: [`stalled in ${held.length} of ${held.length + clean.length} attempts: ${held.map(stallWords).join('; ')}`], discarded: 0, notes: [] };
  }
  const base = baselineOf(clean.map((s) => s.counters), attribution.counters);
  const notes = [];
  for (const h of held) {
    const who = attribute(h, base, attribution.ticks);
    if (who.by === 'page') return { problems: [`${stallWords(h)} while the page worked: ${who.over.join(', ')}`], discarded: 0, notes };
    notes.push(`discarded: ${stallWords(h)}; no counter above its baseline (${attribution.counters.map((c) => `${c} ${Math.round(h[c])}/${Math.round(base[c].mean)}`).join(', ')})`);
  }
  return { problems: clean.flatMap((s) => judge(s.frames)), discarded: held.length, notes };
}

/** The sweep-wide ceiling: red when discarded samples exceed CEILING of the transitions sampled. */
export function ceilingProblem(discarded, transitions) {
  return transitions > 0 && discarded / transitions > CEILING
    ? [`${discarded} of ${transitions} transitions stalled outside the page (ceiling ${CEILING * 100}%)`] : [];
}
