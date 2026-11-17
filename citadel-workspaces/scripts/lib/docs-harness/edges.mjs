/**
 * How sharp text is, measured on pixels: the width of every ink edge in a grayscale crop.
 *
 * An edge is a run of pixels between paper and ink. Its width counts the pixels strictly between
 * 10% and 90% of the paper-to-ink step: 0 is a hard step, 1 is ordinary antialiasing, and a canvas
 * resampled by a fractional offset smears each edge over one more pixel than that.
 */

/** Luminance 0..255 of RGBA pixels. */
export function grayscale(rgba, width, height) {
  const out = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = 0.2126 * rgba[4 * i] + 0.7152 * rgba[4 * i + 1] + 0.0722 * rgba[4 * i + 2];
  return out;
}

/** Edge widths along one line of samples (a row or a column), paper `hi`, ink `lo`. */
export function edgeWidths(line, hi, lo) {
  const step = hi - lo;
  const level = (v) => (v >= hi - 0.1 * step ? 'paper' : v <= lo + 0.1 * step ? 'ink' : 'mid');
  const widths = [];
  let last = null;
  let mids = 0;
  for (const v of line) {
    const l = level(v);
    if (l === 'mid') { mids++; continue; }
    if (last !== null && last !== l) widths.push(mids);
    last = l;
    mids = 0;
  }
  return widths;
}

/**
 * Every edge of the ink in a crop, across rows (vertical stems) and down columns (horizontal
 * strokes), with paper and ink read from the crop itself (its brightest and darkest pixels).
 */
export function measureEdges(gray, width, height) {
  let hi = 0;
  let lo = 255;
  for (const v of gray) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
  if (hi - lo < 128) throw new Error(`the crop has no text: paper ${hi.toFixed(0)}, darkest ${lo.toFixed(0)}`);
  const across = [];
  const down = [];
  for (let y = 0; y < height; y++) across.push(...edgeWidths(gray.subarray(y * width, (y + 1) * width), hi, lo));
  for (let x = 0; x < width; x++) {
    const column = new Float64Array(height);
    for (let y = 0; y < height; y++) column[y] = gray[y * width + x];
    down.push(...edgeWidths(column, hi, lo));
  }
  return { across: summary(across), down: summary(down) };
}

function summary(widths) {
  if (widths.length === 0) throw new Error('no ink edges in the crop');
  const sorted = [...widths].sort((a, b) => a - b);
  const mean = sorted.reduce((s, w) => s + w, 0) / sorted.length;
  return { edges: sorted.length, mean: Math.round(mean * 100) / 100, p90: sorted[Math.floor(0.9 * (sorted.length - 1))] };
}
