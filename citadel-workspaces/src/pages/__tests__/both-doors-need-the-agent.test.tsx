import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every way into a flow that needs the agent must consult the agent's health.
 *
 * The landing screen has two buttons side by side. Round 635 guarded "Create
 * Account" -- `useOnboardingIntent` refuses to open while the agent is
 * unreachable -- and left "Sign In" untouched, so the fix was applied to one of
 * the two places its own reasoning covered. That reasoning ("the retry dialog
 * has to win: it alone carries the download links and the run command") is
 * about the SCREEN, not about registration.
 *
 * Unguarded, a visitor with no agent gets the sign-in card (`fixed inset-0
 * z-50`, its own focus trap), then ConnectionRetryModal on top, OfflineBanner
 * above, and after typing credentials "Connection timeout, check your network"
 * -- which names neither the agent nor the fix.
 *
 * Read as source rather than rendered because the property is "no entry point
 * is missing the check". Rendering proves things about the paths a test
 * remembers to exercise; the omission that caused this was a path nobody
 * thought to exercise, which is exactly what a render test cannot see. The two
 * behavioural halves ARE covered by rendering, in
 * `src/hooks/__tests__/onboarding-waits-for-the-agent.test.tsx`.
 */
const LANDING: string = readFileSync(
  join(process.cwd(), 'src', 'pages', 'Landing.tsx'),
  'utf8',
);

/** Strip comments: the explanation of a guard is not a guard. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
}

describe('the landing screen and the agent', () => {
  const body: string = code(LANDING);

  it('reads the agent gate', () => {
    expect(body).toMatch(/useAgentGatedStep/);
  });

  it('routes the sign-in flow through the agent gate', () => {
    expect(body).toMatch(/startLogin[\s\S]{0,40}?=\s*useAgentGatedStep\s*\(/);
    expect(body).toMatch(/useAgentGatedStep\(setCurrentStep,\s*'login',\s*'none'\)/);
  });

  it('the gate itself both refuses to open and retreats once open', () => {
    // Both halves, in the hook that owns them. They cover different moments --
    // `useServiceHealth` starts optimistic, so a click in the first seconds
    // still gets through and the retreat is what covers that window. Splitting
    // them across call sites is how one gets applied and the other forgotten.
    const gate: string = code(
      readFileSync(join(process.cwd(), 'src', 'hooks', 'use-agent-gate.ts'), 'utf8'),
    );
    expect(gate).toMatch(/if\s*\(!isHealthy\)\s*\{[\s\S]*?return;/);
    expect(gate).toMatch(/if\s*\(!isHealthy\)\s*setStep/);
    expect(gate).toMatch(/useServiceHealth\s*\(/);
  });

  it('and the refusal leads somewhere, on BOTH doors', () => {
    // Refusing is only half of it. `ConnectionRetryModal` is the surface that
    // explains the state and carries the download link, and a dismissal of it
    // sticks by design -- so after a dismissal both doors answered a click with
    // nothing at all: no dialog, no message, no navigation. Measured on a
    // production bundle with the agent down: zero dialogs after pressing
    // Create Account.
    //
    // Pinned on BOTH files in one test, because this rule has now reached one
    // door and not the other TWICE -- round 635 guarded Create Account and not
    // Sign In, and the first fix for the silence went to Sign In and not back
    // to Create Account.
    const gate: string = code(
      readFileSync(join(process.cwd(), 'src', 'hooks', 'use-agent-gate.ts'), 'utf8'),
    );
    const intent: string = code(
      readFileSync(join(process.cwd(), 'src', 'hooks', 'useOnboardingIntent.ts'), 'utf8'),
    );
    for (const [name, source] of [['use-agent-gate', gate], ['useOnboardingIntent', intent]] as const) {
      expect(source, `${name} must ask for the retry dialog before refusing`)
        .toMatch(/askWhyTheAgentIsUnreachable\(\)/);
    }
  });

  it('routes account creation through the health-guarded hook', () => {
    // The other door. Named here so removing EITHER guard fails this file,
    // rather than each being pinned in a place the other's author never opens.
    expect(body).toMatch(/useOnboardingIntent\s*\(/);
    // `[^=]*` cannot cross the `=` in the annotation `: () => void`, which is
    // how this assertion first failed against correct code.
    expect(body).toMatch(/startRegistration[\s\S]{0,40}?=\s*intent\.request/);
  });

  it('reads a Landing.tsx that actually has both buttons', () => {
    // Floor. Every assertion above is over a string; if the file moved or the
    // read returned something unexpected, they would all pass or all fail for
    // reasons unrelated to the guards.
    expect(LANDING.length).toBeGreaterThan(2000);
    expect(LANDING).toContain('create-account-button');
    expect(LANDING).toContain('Sign In');
  });
});
