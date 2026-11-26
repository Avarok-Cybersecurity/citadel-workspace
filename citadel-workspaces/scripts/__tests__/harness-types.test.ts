/**
 * The harness-type ratchet counts per file and code and fails both ways. The negative control is the
 * first test: a new error in a file that already has errors of that code must still be counted.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain ESM script with no declarations
import { compareToBaseline, countErrors } from '../harness-types-core.mjs';

const OUT: string = [
  "scripts/lib/polish-harness/scenarios-calendar.jsx(79,7): error TS2345: Argument of type '{ ports: ... }' is not assignable.",
  "scripts/lib/polish-harness/scenarios-calendar.jsx(90,7): error TS2345: Argument of type 'x' is not assignable.",
  "scripts/lib/polish-harness/scenarios-people.jsx(31,27): error TS2741: Property 'banned' is missing.",
  "src/lib/x.ts(1,1): error TS2503: Cannot find namespace 'NodeJS'.",
  '  continuation line of a long message',
].join('\n');

describe('harness type errors against the baseline', () => {
  it('counts each harness file per error code, ignoring everything that is not a harness scenario', () => {
    expect(countErrors(OUT)).toEqual({
      'scripts/lib/polish-harness/scenarios-calendar.jsx': { TS2345: 2 },
      'scripts/lib/polish-harness/scenarios-people.jsx': { TS2741: 1 },
    });
  });

  it('a new error of a code the file already has is a regression', () => {
    const baseline = { 'scripts/lib/polish-harness/scenarios-calendar.jsx': { TS2345: 1 }, 'scripts/lib/polish-harness/scenarios-people.jsx': { TS2741: 1 } };
    expect(compareToBaseline(countErrors(OUT), baseline).grew).toEqual([
      { file: 'scripts/lib/polish-harness/scenarios-calendar.jsx', code: 'TS2345', was: 1, now: 2 },
    ]);
  });

  it('a fixed error shows as shrunk, so the baseline is lowered rather than left with room for a new one', () => {
    const baseline = { 'scripts/lib/polish-harness/scenarios-calendar.jsx': { TS2345: 2 }, 'scripts/lib/polish-harness/scenarios-people.jsx': { TS2741: 2 } };
    const { grew, shrank } = compareToBaseline(countErrors(OUT), baseline);
    expect(grew).toEqual([]);
    expect(shrank).toEqual([{ file: 'scripts/lib/polish-harness/scenarios-people.jsx', code: 'TS2741', was: 2, now: 1 }]);
  });
});
