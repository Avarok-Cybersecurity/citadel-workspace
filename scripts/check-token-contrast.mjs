#!/usr/bin/env node
/**
 * Every semantic foreground must clear WCAG AA on the surface it names.
 *
 * `check-destructive-contrast.mjs` does this for one token family, and found a
 * real defect doing it: `--destructive` used as body text was 3.72:1 on
 * `--background`, under the floor, in every inline error in the app. The
 * technique worked and then stopped at the family it was written for. Ten other
 * pairings — foreground/background, card, popover, surface, primary, secondary,
 * muted, accent — went unchecked in both themes.
 *
 * They all pass today, so this is a lock rather than a repair. It is worth
 * locking because of what the numbers look like up close:
 *
 *     dark   destructive-foreground on --destructive   4.53:1  (needs 4.50)
 *
 * Three hundredths of margin. A designer nudging that token's lightness by one
 * percent would take white-on-red below AA everywhere it is used, and nothing
 * would say so — axe only measures what is rendered during a scan, and a
 * destructive button is not on the pre-auth screens.
 *
 * Muted foreground is checked against `--background` and `--card` as well as
 * its own `--muted`, because that is where it is actually read: secondary text
 * sits on the page and on cards far more often than on a muted block.
 *
 * Pure file reads and arithmetic — no browser, no toolchain, no network.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = join(ROOT, 'citadel-workspaces', 'src', 'index.css');

if (!existsSync(CSS)) {
  // A guard that cannot find what it guards has verified nothing, so this is a
  // failure rather than a skip.
  console.error('check-token-contrast: index.css is missing, so nothing was checked.');
  process.exit(1);
}

const css = readFileSync(CSS, 'utf8');
const AA_BODY = 4.5;

/** All `--name: H S% L%` declarations, in source order. */
function declarations(name) {
  const re = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`, 'g');
  return [...css.matchAll(re)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
}

function hslToRgb([h, s, l]) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
function ratio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** [foreground token, surface token] — what is read on what. */
const PAIRS = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['surface-foreground', 'surface'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
];

const needed = [...new Set(PAIRS.flat())];
const decls = Object.fromEntries(needed.map((t) => [t, declarations(t)]));

for (const [name, list] of Object.entries(decls)) {
  // Exactly two, not "at least two": the themes are read positionally as
  // [:root, dark]. A third declaration would shift that silently and the gate
  // would measure the wrong colours while still reporting a pass.
  if (list.length !== 2) {
    console.error(
      `check-token-contrast: expected exactly 2 declarations of --${name} ` +
        `(:root then the dark block), found ${list.length}. This gate reads them positionally.`,
    );
    process.exit(1);
  }
}

const failures = [];
const rows = [];

for (const [index, theme] of [[0, 'light'], [1, 'dark']]) {
  for (const [fg, bg] of PAIRS) {
    const value = ratio(hslToRgb(decls[fg][index]), hslToRgb(decls[bg][index]));
    rows.push(
      `  ${theme.padEnd(5)} ${`--${fg} on --${bg}`.padEnd(46)} ${value.toFixed(2)}:1  (needs ${AA_BODY})`,
    );
    if (value < AA_BODY) {
      failures.push(`${theme}: --${fg} on --${bg} is ${value.toFixed(2)}:1, below ${AA_BODY}`);
    }
  }
}

console.log(rows.join('\n'));
if (failures.length > 0) {
  console.error('\ncheck-token-contrast: semantic text fails WCAG AA:\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}
console.log(`\ncheck-token-contrast: OK — ${PAIRS.length * 2} pairings clear AA across both themes.`);
