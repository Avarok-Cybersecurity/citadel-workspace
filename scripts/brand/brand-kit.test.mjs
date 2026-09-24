// node --test scripts/brand/brand-kit.test.mjs
//
// The derivation is tested against the real kit (it is data in this repo, not a fixture) and
// against the kit with one thing broken, so each refusal is shown to fire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pairArtwork, parseArtwork, clearSpaceUnits, uiFiles, PUBLIC_COPIES, renderAdaptiveFavicon } from './brand-kit.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'brand');
const read = (p) => readFileSync(join(KIT, p));
const text = (p) => read(p).toString('utf8');
const brand = JSON.parse(text('tokens/brand.json'));

test('the plain and -ondark cuts pair into one drawing', () => {
  const art = pairArtwork(text('svg/logo-horizontal.svg'), text('svg/logo-horizontal-ondark.svg'), brand, 'h');
  assert.equal(art.viewBox, '0 -246.91 2194.74 317.91');
  assert.ok(art.glyphs && art.glyphs.length > 1000, 'the outlined name is carried, not retyped');
});

test('a pair that is not the same drawing is refused', () => {
  const plain = text('svg/mark.svg');
  const moved = text('svg/mark-ondark.svg').replace('M100 40H162', 'M100 40H170');
  assert.throws(() => pairArtwork(plain, moved, brand, 'mark'), /differ in arrow/);
});

test('a purple C is refused: the C is ink, only the arrow is purple', () => {
  const purpleC = text('svg/mark.svg').replace('stroke="#1C1D28"', 'stroke="#6E59A5"');
  assert.throws(() => pairArtwork(purpleC, text('svg/mark-ondark.svg'), brand, 'mark'), /arc is #6E59A5/);
});

test('the light-ground arrow on the dark cut is refused (2.9:1 on #1C1D28)', () => {
  const wrong = text('svg/mark-ondark.svg').replace('#9B87F5', '#6E59A5');
  assert.throws(() => pairArtwork(text('svg/mark.svg'), wrong, brand, 'mark'), /arrow is #6E59A5 onDark/);
});

test('clear space is one arrowhead: 46 in the mark grid, scaled with the C', () => {
  const unit = (plain) => clearSpaceUnits(parseArtwork(text(plain), plain), brand);
  assert.equal(unit('svg/mark.svg'), 46);
  assert.equal(unit('svg/mark-compact.svg'), 46);
  // The horizontal lockup draws the C at r 127.16 against the grid's 60.
  assert.equal(unit('svg/logo-horizontal.svg'), 97.49);
});

test('public files are the kit bytes, untouched', () => {
  const files = new Map(uiFiles(read));
  for (const [from, to] of PUBLIC_COPIES) {
    assert.ok(read(from).equals(files.get(`public/${to}`)), `${to} is not ${from}`);
  }
});

test('the favicon takes the -ondark colours only on a dark scheme', () => {
  const svg = renderAdaptiveFavicon(text('favicon.svg'), text('favicon-ondark.svg'), brand);
  const [base, dark] = svg.split('@media (prefers-color-scheme: dark)');
  assert.match(base, /\.ink \{ stroke: #1C1D28; \}/);
  assert.match(base, /\.arrow \{ stroke: #6E59A5; \}/);
  assert.match(dark, /\.ink \{ stroke: #FFFFFF; \}/);
  assert.match(dark, /\.arrow \{ stroke: #9B87F5; \}/);
  assert.match(svg, /stroke-width="22"/, 'the compact cut: a favicon is drawn under 32 px');
});
