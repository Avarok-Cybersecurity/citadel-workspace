/**
 * The integration suite's readiness probe must not key on button copy.
 *
 * `waitForAppReady` waited for `button:has-text("Join Workspace")` and
 * `"Login Workspace"`. Renaming those buttons — because neither was English and
 * "Join" meant *create an account* — made every Playwright shard and four
 * integration legs time out there, sixty seconds each, reporting only that the
 * React app never rendered. It had rendered perfectly. The probe was asking for
 * words that no longer existed.
 *
 * A readiness probe is the first thing every spec runs, so when it breaks
 * everything breaks, and it reports the least useful possible cause. It must be
 * the thing LEAST coupled to what the product says.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/test-utils/strip-comments';

const PROBE: string = join(process.cwd(), 'integration-tests/src/lib/browser.ts');

/** The testids the probe waits for, which the app must therefore render. */
const REQUIRED_TESTIDS: string[] = ['sign-in-button', 'create-account-button'];

describe('the app-ready probe', () => {
  it('waits on testids, not on what a button says', () => {
    // The suite lives beside src/ but is a separate package; a missing file
    // means this scan checked nothing, so it fails rather than passing.
    expect(existsSync(PROBE), `${PROBE} is missing`).toBe(true);

    const source: string = stripComments(readFileSync(PROBE, 'utf-8'));
    const probe: string = source.slice(source.indexOf('export async function waitForAppReady'));
    const body: string = probe.slice(0, probe.indexOf('\n}'));

    expect(
      body,
      'the probe matches on button text, so renaming a button times out every ' +
        'spec in the suite at sixty seconds each, reporting only that the app ' +
        'never rendered',
    ).not.toMatch(/has-text\(/);
  });

  it('waits for testids the landing page actually renders', () => {
    // The other half: a probe keyed on a testid nobody renders is the same
    // outage with a different cause.
    const landing: string = readFileSync(join(process.cwd(), 'src/pages/Landing.tsx'), 'utf-8');

    for (const testid of REQUIRED_TESTIDS) {
      expect(landing, `Landing must render data-testid="${testid}"`).toContain(
        `data-testid="${testid}"`,
      );
    }
  });

  it('has the probe waiting for exactly those testids', () => {
    const source: string = stripComments(readFileSync(PROBE, 'utf-8'));
    for (const testid of REQUIRED_TESTIDS) {
      expect(source, `the probe should wait for ${testid}`).toContain(testid);
    }
  });
});
