/**
 * Scores how rough a sidebar transition is, from the frames motion-sampler.mjs records.
 *
 * Every tree row (`[data-tree-node]`) is tracked as a person sees it: a row that changes list is a new element
 * in its new place, so the on-screen row is keyed by its node id while it is live, and a leaving copy (which
 * drops its role) is tracked on its own. The boxes -- the ancestor stack, the sibling list, the whole tree and
 * what sits below it -- are tracked too. Each track is the box as drawn (transforms included) clipped by
 * every overflow-hiding ancestor, and how opaque it is.
 *
 * Rough is, numerically:
 *   reversal  -- a top or height that moves one way, then the other (each leg > 1px);
 *   jump      -- a single frame that moves a moving thing by more than JUMP_PX, out of step with its neighbours;
 *   overlap   -- two rows that are both mostly opaque whose paint (the line's fill if it has one, else its text
 *                and icons) overlaps by more than OVERLAP_PX in one frame;
 *   snap      -- something that ends > 2px from where it started with no frame in between.
 */
export const JUMP_PX = 12;
export const OVERLAP_PX = 4;
const OPAQUE = 0.5;

/** One track's samples, in frame order, from the frame it first appears to the frame it last does. */
function tracks(frames) {
  const out = new Map();
  frames.forEach((f, i) => {
    for (const [key, v] of Object.entries(f)) {
      if (key === 't') continue;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({ ...v, frame: i, t: f.t });
    }
  });
  return out;
}

/** True when the series travels > 1px one way and then > 1px back. Sub-pixel jitter is ignored. */
function reversals(series) {
  const legs = [];
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (Math.abs(d) < 0.25) continue;
    const last = legs[legs.length - 1];
    if (last && Math.sign(last) === Math.sign(d)) legs[legs.length - 1] += d; else legs.push(d);
  }
  const real = legs.filter((l) => Math.abs(l) > 1);
  return real.some((l, i) => i > 0 && Math.sign(l) !== Math.sign(real[i - 1]));
}

/**
 * The runs of one property to judge as continuous. A row that changes list is a new element that cross-fades
 * in over the old one (framer's shared layout), so its HEIGHT may differ across that hand-over -- the two are
 * blended, not swapped -- and its opacity starts again from the new copy's, but its POSITION must carry
 * straight on.
 */
function runs(samples, prop) {
  if (prop === 'shownTop') return [samples];
  const out = [[]];
  samples.forEach((s, i) => {
    if (i > 0 && s.el !== samples[i - 1].el && (prop === 'opacity' || s.opacity < OPAQUE)) out.push([]);
    out[out.length - 1].push(s);
  });
  return out;
}

/**
 * A jump: a frame moving something over JUMP_PX, at more than twice both neighbours' SPEED (slow machines have
 * long, uneven frames). A bare threshold would fail any long glide: 150px in 13 frames averages 11.5px a frame.
 * The FIRST step has one neighbour, and on a slow machine that comparison is wrong: the click's commit holds the
 * first paint back (measured: 30ms at 4x CPU throttle, 55ms at 6x), so that frame averages the curve's steep start
 * and its neighbour the tail, while the positions still sit on the 1x curve at the same times. So the first step
 * is held to the curve: no frame of a smooth glide averages faster than its peak, GLIDE_PEAK x its mean speed.
 */
const GLIDE_PEAK = 4.05; // the steepest slope of cubic-bezier(0.2, 0, 0, 1), tree-motion's GLIDE, computed numerically
function spikes(series, steps, times) {
  const speed = steps.map((d, i) => d / Math.max(1, times[i + 1] - times[i]));
  const end = series[series.length - 1];
  const settled = Math.min(series.length - 1, series.findLastIndex((v) => Math.abs(v - end) > 0.5) + 1);
  const mean = Math.abs(end - series[0]) / Math.max(1, times[settled] - times[0]);
  // The last step has no successor to compare with; a track that ends by vanishing is judged as an appearance.
  return steps.filter((d, i) => d > JUMP_PX && (i === 0
    ? speed[0] > GLIDE_PEAK * mean
    : i < steps.length - 1 && speed[i] > 2 * Math.max(speed[i - 1], speed[i + 1])));
}

/**
 * Something that comes or goes at strength: a track that starts or ends with a visible frame more than half
 * opaque, unless the same node is on screen in the neighbouring frame (a row handed from its live element
 * to its leaving copy, or the reverse, is one row). Fading out and then snapping back for a frame is caught
 * as a reversal of opacity.
 */
function appearances(frames, found) {
  const node = (key) => key.slice(key.indexOf(':') + 1);
  // And what has not finished when sampling ends: a leaving copy still drawn, or a live row not yet opaque.
  for (const [key, v] of Object.entries(frames[frames.length - 1])) {
    if (key === 't' || !v.row || v.shown <= 1) continue;
    if (key.startsWith('ghost') && v.opacity > 0.05) found.snap.push(`${key} never left (opacity ${v.opacity.toFixed(2)})`);
    if (key.startsWith('row') && v.opacity < 0.95) found.snap.push(`${key} never arrived (opacity ${v.opacity.toFixed(2)})`);
  }
  const shown = (v) => v && v.shown > 1 && v.opacity > OPAQUE;
  const nodesIn = (f) => new Set(Object.keys(f).filter((k) => k !== 't' && f[k].row).map(node));
  for (let i = 1; i < frames.length - 1; i++) {
    const [before, now, after] = [frames[i - 1], frames[i], frames[i + 1]];
    for (const [key, v] of Object.entries(now)) {
      if (key === 't' || !v.scored || !v.row) continue;
      if (!(key in before) && shown(v) && !nodesIn(before).has(node(key))) found.snap.push(`${key} appeared at opacity ${v.opacity.toFixed(2)} (frame ${i})`);
      if (!(key in after) && shown(v) && !nodesIn(after).has(node(key))) found.snap.push(`${key} vanished at opacity ${v.opacity.toFixed(2)} (frame ${i})`);
    }
  }
}

/** What is rough about `frames`, as lists of human-readable findings per criterion. */
export function roughness(frames) {
  const found = { reversal: [], jump: [], overlap: [], snap: [], steep: [] };
  for (const [key, samples] of tracks(frames)) {
    if (!samples[0].scored) continue;
    const visible = samples.filter((s) => s.shown > 1 && s.opacity > 0.05);
    for (const run of runs(visible, 'opacity')) {
      const fade = run.map((s) => s.opacity);
      if (reversals(fade.map((o) => o * 100))) found.reversal.push(`${key}.opacity ${fade.map((o) => o.toFixed(2)).join(',')}`);
    }
    for (const prop of ['shownTop', 'shown']) {
      for (const run of runs(visible, prop)) {
        const series = run.map((s) => s[prop]);
        if (series.length < 2) continue;
        const label = `${key}.${prop}`;
        if (reversals(series)) found.reversal.push(`${label} ${series.map((v) => v.toFixed(0)).join(',')}`);
        const steps = series.slice(1).map((v, i) => Math.abs(v - series[i]));
        // A row's clipped height changes as fast as the edge sweeping it moves: that edge's box is judged, not the row.
        const swept = prop === 'shown' && run[0].row;
        const spiked = swept ? [] : spikes(series, steps, run.map((r) => r.t));
        if (spiked.length > 0) found.jump.push(`${label} ${Math.max(...spiked).toFixed(1)}px in one frame: ${series.map((v) => v.toFixed(0)).join(',')}`);
        if (Math.max(...steps) > JUMP_PX) found.steep.push(`${label} ${Math.max(...steps).toFixed(1)}px`);
        const first = series[0];
        const last = series[series.length - 1];
        const between = series.filter((v) => v > Math.min(first, last) + 0.5 && v < Math.max(first, last) - 0.5).length;
        // Two frames have nothing between them to judge: a copy seen for two frames as it fades is not a snap.
        if (!swept && series.length > 2 && Math.abs(last - first) > 2 && between === 0) found.snap.push(`${label} ${first.toFixed(0)} -> ${last.toFixed(0)}`);
      }
    }
  }
  appearances(frames, found);
  frames.forEach((f, i) => {
    const rows = Object.entries(f).filter(([key, v]) => key !== 't' && v.row && v.shown > 1 && v.opacity > OPAQUE);
    const node = (key) => key.slice(key.indexOf(':') + 1);
    for (let a = 0; a < rows.length; a++) {
      for (let b = a + 1; b < rows.length; b++) {
        const [ka, va] = rows[a];
        const [kb, vb] = rows[b];
        // A row's own cross-fade: the copy it is leaving behind and the one taking its place.
        if (node(ka) === node(kb)) continue;
        const overlap = Math.min(va.inkTop + va.ink, vb.inkTop + vb.ink) - Math.max(va.inkTop, vb.inkTop);
        if (overlap > OVERLAP_PX) found.overlap.push(`frame ${i}: ${ka} and ${kb} by ${overlap.toFixed(1)}px`);
      }
    }
  });
  return found;
}

export const ROUGH = ['reversal', 'jump', 'overlap', 'snap'];
