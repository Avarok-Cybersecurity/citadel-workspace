/**
 * No stylesheet rule may set text below the 12px legibility floor.
 *
 * Lighthouse measured 44.85% of the landing page as illegible and named
 * `.text-xs` at 10.5px — Tailwind's `0.75rem` against a 14px document root
 * (round 185). That was a Tailwind-scale problem and was fixed there.
 *
 * `index.css` had five more, written as flat pixels, which Lighthouse never saw
 * because they live on collaborative-editor surfaces rather than the landing
 * page: a collaborator's name in a cursor tooltip at 11px, a comment's author
 * at 11px, its timestamp at 10px.
 *
 * Absolute sizes are worse than the Tailwind case in one respect. `text-xs`
 * at least grows when the user raises the font-size setting; a flat 10px does
 * not, so someone who set the app to 18px because they could not read it still
 * got a 10px timestamp.
 *
 * Hierarchy below 12px is not hierarchy. It is two sizes of unreadable, and
 * weight and colour carry the distinction without costing legibility.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path: string = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const CSS: string = join(process.cwd(), 'src/index.css');

/** Arbitrary Tailwind sizes below the floor, e.g. `text-[11px]`. */
const ARBITRARY_TOO_SMALL: RegExp = /text-\[(?:[0-9]|10|11)px\]/;

describe('component class names', () => {
  it('do not set an arbitrary size below the floor', () => {
    // There were 38 of these across 15 files -- form labels on the login and
    // join screens among them, so the first text anyone reads in this product
    // was 11px. Absolute, so they did not grow when a user raised the font-size
    // setting either: someone who set the app to 18px because they could not
    // read it still got an 11px "USERNAME".
    //
    // They are `text-xs` now, which is `max(12px, 0.75rem)` -- one scale, one
    // floor, and it grows with the setting.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      // Comments stripped first. This repository's guards keep flagging their
      // own explanations -- round 188's did, and the fix was not carried here:
      // a comment recording that `text-[11px]` WAS raised to `text-xs` reads as
      // a live `text-[11px]`. A rule that punishes writing down why is a rule
      // people route around.
      const body: string = readFileSync(file, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (ARBITRARY_TOO_SMALL.test(body)) offenders.push(file.split('/src/')[1]);
    }
    expect(offenders).toEqual([]);
  });
});

describe('every font-size in index.css', () => {
  const source: string = readFileSync(CSS, 'utf-8');

  it('reads a real stylesheet, so the rule is not passing over nothing', () => {
    expect(source.length).toBeGreaterThan(5000);
    expect(source).toMatch(/font-size:/);
  });

  it('is at least 12px', () => {
    const tooSmall: string[] = [];
    for (const [index, line] of source.split('\n').entries()) {
      // Only bare pixel declarations. `max(12px, 0.75rem)` names a floor and a
      // scaling value, and reading its first argument as the size would flag
      // the fix as the defect.
      const match: RegExpExecArray | null = /font-size:\s*(\d+(?:\.\d+)?)px\s*;/.exec(line);
      if (!match) continue;
      if (Number(match[1]) < 12) tooSmall.push(`index.css:${index + 1} — ${line.trim()}`);
    }
    expect(tooSmall).toEqual([]);
  });
});
