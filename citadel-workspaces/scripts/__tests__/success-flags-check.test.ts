/**
 * The discarded-success-flags check counts a dropped `boolean` and does not
 * count a dropped literal `true`: a function typed `Promise<true>` can only
 * succeed or reject, so there is no `false` to lose. The negative control is the
 * first test -- a function that CAN return false must still be counted, or the
 * `true` exemption has quietly become "count nothing".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- a plain ESM script with no declarations
import { findDiscards } from '../success-flags-core.mjs';

const dirs: string[] = [];
afterEach((): void => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function discardsIn(source: string): string[] {
  const root: string = mkdtempSync(join(tmpdir(), 'flags-'));
  dirs.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'tsconfig.app.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', noEmit: true },
    include: ['src'],
  }));
  writeFileSync(join(root, 'src', 'a.ts'), source);
  return findDiscards(root) as string[];
}

describe('the discarded-success-flags check', () => {
  it('counts a dropped boolean', () => {
    expect(discardsIn('async function save(): Promise<boolean> { return false; }\nexport async function run(): Promise<void> { await save(); }\n'))
      .toEqual(['src/a.ts::save']);
  });

  it('counts a dropped boolean that is not async', () => {
    expect(discardsIn('function save(): boolean { return false; }\nexport function run(): void { save(); }\n')).toEqual(['src/a.ts::save']);
  });

  it('does not count a function that can only return true', () => {
    expect(discardsIn('async function save(): Promise<true> { return true; }\nexport async function run(): Promise<void> { await save(); }\n'))
      .toEqual([]);
  });

  it('does not count a used answer', () => {
    expect(discardsIn('function save(): boolean { return false; }\nexport function run(): boolean { return save(); }\n')).toEqual([]);
  });
});
