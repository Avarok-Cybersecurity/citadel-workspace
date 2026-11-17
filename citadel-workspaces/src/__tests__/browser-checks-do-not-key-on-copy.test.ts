/**
 * The browser-driving scripts must address controls by testid, not by copy.
 *
 * `waitForAppReady` was migrated off `button:has-text("Join Workspace")` when
 * those buttons became "Sign In" and "Create Account", and a guard was added so
 * it could not regress. That guard covers `integration-tests/`. It does not
 * cover `scripts/`, and `check-mobile-layout.mjs` still clicked
 * `getByRole('button', { name: /Join Workspace/i })` — so it had been failing on
 * a thirty-second locator timeout ever since.
 *
 * Invisibly, for two reasons that compound: the script needs a browser and a
 * served build, so it never runs in preflight; and the CI job it lives in was
 * already failing earlier, on the offline check and then on Lighthouse. **A dead
 * check behind a failing check is indistinguishable from a passing one.** Fixing
 * those two gates is what surfaced this one.
 *
 * So this is the same fix as round 168, applied to the directory that one
 * missed — which is the recurring shape here: a correct fix that reached one of
 * the places it belonged.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPTS: string = join(process.cwd(), 'scripts');

/** Playwright locators that address a control by what it says. */
const COPY_LOCATORS: RegExp[] = [
  /getByRole\(\s*['"]button['"]\s*,\s*\{\s*name:/,
  /has-text\(/,
  /getByText\(/,
];

function browserScripts(): string[] {
  return readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => join(SCRIPTS, f))
    .filter((f) => readFileSync(f, 'utf-8').includes("from 'playwright'"));
}

/** Lines a `copy-under-test:` comment immediately above declares exempt. */
function exemptions(files: string[]): Set<string> {
  const exempt: Set<string> = new Set<string>();
  for (const file of files) {
    const name: string | undefined = file.split('/').pop();
    const lines: string[] = readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, index) => {
      if (!/copy-under-test:/.test(line)) return;
      // Everything from the marker to the next non-comment line.
      let cursor: number = index + 1;
      while (cursor < lines.length && /^\s*(\/\/|\*)/.test(lines[cursor])) cursor += 1;
      if (cursor < lines.length) exempt.add(`${name}:${cursor}`);
    });
  }
  return exempt;
}

describe('the browser-driving check scripts', () => {
  const scripts: string[] = browserScripts();
  const exempt: Set<string> = exemptions(scripts);

  it('finds some, so the rule is not passing over an empty list', () => {
    // Every guard in this repo that silently checked nothing looked exactly
    // like a passing one.
    expect(scripts.length).toBeGreaterThanOrEqual(3);
  });

  it('address controls by testid, not by what a button says', () => {
    const offenders: string[] = [];
    for (const file of scripts) {
      const name: string | undefined = file.split('/').pop();
      for (const [index, line] of readFileSync(file, 'utf-8').split('\n').entries()) {
        // Comment lines are where the reasoning lives, and this repo's
        // reasoning routinely quotes the very locators it bans.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (!COPY_LOCATORS.some((p) => p.test(line))) continue;
        // An exemption has to STATE ITSELF, immediately above the line it
        // covers. A name in a list elsewhere is a claim nobody re-reads; this
        // one is impossible to move away from what it excuses. Copy is the
        // right locator when the copy is the thing under test — a check that
        // the user is told something must read what they are told.
        if (exempt.has(`${name}:${index}`)) continue;
        offenders.push(`${name}:${index + 1} — ${line.trim().slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
