#!/usr/bin/env node
/**
 * Fails if destructive TEXT is below WCAG AA on any background it is read on.
 *
 * `--destructive` is a SURFACE token: white `--destructive-foreground` sits on
 * it, which is what pins its dark value at 50% lightness. The same colour used
 * as body text was 3.72:1 on --background and 3.38:1 on --card, under the
 * 4.5:1 floor, and every inline error in the app was rendered in it. Text
 * therefore has its own token, `--destructive-emphasis`.
 *
 * axe cannot catch this: it only measures what is on screen, and error states
 * are not rendered during the page scans. One rendered assertion covers the
 * join form's inline error; this covers the rest of the pairings by computing
 * them from the tokens, including the TINTED backgrounds the colour appears on
 * (bg-destructive/10 in the error boxes, /20 in the Banned badge) which are the
 * ones a plain foreground-on-background check misses.
 *
 * Pure file reads and arithmetic: no browser, no toolchain, no network.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'citadel-workspaces', 'src', 'index.css');

if (!existsSync(CSS)) {
  // A guard that cannot find what it guards has verified NOTHING, so this is a
  // failure, not a skip. Every CI job that runs these uses
  // `submodules: recursive`, so an absent path means a broken checkout — which
  // used to be reported as a pass.
  console.error('check-destructive-contrast: index.css is missing, so nothing was checked.');
  process.exit(1);
}

const css = readFileSync(CSS, 'utf8');
const AA_BODY = 4.5;
const AA_UI = 3.0; // white-on-surface for buttons is still body text; kept for clarity

/** All `--name: H S% L%` declarations, in source order. */
function declarations(name) {
  const out = [];
  for (const m of css.matchAll(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`, 'g'))) {
    out.push([Number(m[1]), Number(m[2]), Number(m[3])]);
  }
  return out;
}

function hslToRgb([h, s, l]) {
  const S = s / 100, L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

// Two declarations each: index 0 is :root (light), index 1 is the dark block.
const tokens = ['background', 'card', 'destructive', 'destructive-emphasis'];
const decls = Object.fromEntries(tokens.map((t) => [t, declarations(t)]));
for (const [name, list] of Object.entries(decls)) {
  // Exactly two, not "at least two": the pairs below are read positionally as
  // [:root, dark]. A third declaration (say inside a media query) would shift
  // that silently and the gate would start measuring the wrong colours while
  // still reporting a pass.
  if (list.length !== 2) {
    console.error(
      `check-destructive-contrast: expected exactly 2 declarations of --${name} ` +
        `(:root then the dark block), found ${list.length}. This gate reads them positionally.`,
    );
    process.exit(1);
  }
}

const failures = [];
const rows = [];

for (const [themeIndex, theme] of [[0, 'light'], [1, 'dark']]) {
  const bg = hslToRgb(decls.background[themeIndex]);
  const card = hslToRgb(decls.card[themeIndex]);
  const surface = hslToRgb(decls.destructive[themeIndex]);
  const text = hslToRgb(decls['destructive-emphasis'][themeIndex]);
  const white = [1, 1, 1];

  const cases = [
    [`emphasis on --background`, ratio(text, bg), AA_BODY],
    [`emphasis on --card`, ratio(text, card), AA_BODY],
    [`emphasis on bg-destructive/10`, ratio(text, over(surface, card, 0.1)), AA_BODY],
    [`emphasis on bg-destructive/20`, ratio(text, over(surface, card, 0.2)), AA_BODY],
    // The reason emphasis exists: the surface token cannot be lightened without
    // breaking this, so it is asserted here to keep the trade-off visible.
    [`white on --destructive (buttons)`, ratio(white, surface), AA_BODY],
  ];

  for (const [label, value, floor] of cases) {
    rows.push(`  ${theme.padEnd(5)} ${label.padEnd(34)} ${value.toFixed(2)}:1  (needs ${floor})`);
    if (value < floor) failures.push(`${theme}: ${label} is ${value.toFixed(2)}:1, below ${floor}`);
  }
}

console.log(rows.join('\n'));
if (failures.length > 0) {
  console.error('\ncheck-destructive-contrast: destructive text fails WCAG AA:\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}
console.log('\ncheck-destructive-contrast: OK — every destructive pairing clears AA in both themes.');
