/**
 * An exported function that nothing refers to is the shape this campaign keeps
 * finding, and it is cheap to detect.
 *
 * Not a style complaint. Every instance so far has been a feature wired from
 * one end: `refresh()` that no component called, so the group list never
 * reconciled with the server. `initPrivacySettingsSync`, so a privacy choice
 * made in one tab never reached the others. A second leader election. A
 * submodule guard that was correct and ran nowhere. In each case the code was
 * written, reviewed and merged, and the only thing missing was a caller.
 *
 * A ratchet rather than a clean sweep. Thirty-eight names are recorded in
 * `unreferenced-exports.baseline.json` as of this commit — some are genuinely
 * dead, some are half-built features worth finishing, and deciding which is
 * which is a change per entry, not one commit. What the ratchet buys
 * immediately is that the list cannot grow: a new unreferenced export fails
 * here, in the commit that adds it, while the author still knows what it was
 * for.
 *
 * The list must also SHRINK honestly. A name that has since gained a caller is
 * an error too, because a stale baseline is how a ratchet quietly stops
 * ratcheting.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanExports } from './unreferenced-exports';
import type { Scan, Unreferenced } from '@/__tests__/unreferenced-exports';

const SRC: string = resolve(__dirname, '..');
const BASELINE: string[] = JSON.parse(
  readFileSync(join(__dirname, 'unreferenced-exports.baseline.json'), 'utf8'),
);

describe('unreferenced exports', () => {
  const scan: Scan = scanExports(SRC);
  const found: Unreferenced[] = scan.unreferenced;
  const names: string[] = found.map((f): string => f.name);

  it('scans a real corpus, so the rule is not passing over nothing', () => {
    // Every guard in this repo that silently checked nothing looked exactly
    // like a passing one.
    //
    // This asserted `BASELINE.length > 10` at first, which was wrong in a way
    // worth keeping the record of: it read the SIZE OF THE PROBLEM as evidence
    // that the rule worked, so the rule began failing the moment the problem
    // got small. The baseline reaching zero is the goal, not a malfunction.
    // What has to be non-trivial is the SCAN.
    expect(scan.examined).toBeGreaterThan(500);
  });

  it('gains none', () => {
    const added: Unreferenced[] = found.filter((f) => !BASELINE.includes(f.name));
    // Named with their file, because the fix is nearly always "call it from
    // where it was meant to be called", not "delete it".
    expect(added.map((f) => `${f.name} (${f.file})`)).toEqual([]);
  });

  it('has no stale entries — fix one, remove it from the baseline', () => {
    const stale: string[] = BASELINE.filter((name) => !names.includes(name));
    expect(stale).toEqual([]);
  });
});
