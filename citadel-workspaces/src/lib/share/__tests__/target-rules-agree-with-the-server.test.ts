/**
 * The UI's target rule is a mirror; the server's (kernel/secure_links/target.rs) is the
 * original. Both suites run every case in one shared fixture in the parent repository, so a rule
 * changed on one side only turns that side's suite red.
 *
 * The fixture exists only on parent revisions that carry secure links. Against one that does
 * not, this skips visibly, with the path, rather than passing.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateShareTarget } from '../target-rules';

const FIXTURE: string = resolve(__dirname, '../../../../../citadel-workspace-types/fixtures/secure-link-targets.json');

interface TargetCase { target: string; padTo?: number; accepted: boolean; reason: string }
interface Fixture { cases: TargetCase[] }

function targetOf(c: TargetCase): string {
  if (c.padTo === undefined) return c.target;
  if (c.target.length > c.padTo) throw new Error(`padTo is shorter than ${c.target}`);
  return c.target + 'a'.repeat(c.padTo - c.target.length);
}

describe.skipIf(!existsSync(FIXTURE))(`share targets agree with ${FIXTURE}`, () => {
  const fixture: Fixture = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture) : { cases: [] };

  it('has the shared cases', () => {
    expect(fixture.cases.length).toBeGreaterThan(40);
  });

  it.each(fixture.cases.map((c: TargetCase) => [JSON.stringify(c.target).slice(0, 80), c] as const))(
    '%s',
    (_label: string, c: TargetCase) => {
      expect(validateShareTarget(targetOf(c)), c.reason).toBe(c.accepted);
    },
  );
});
