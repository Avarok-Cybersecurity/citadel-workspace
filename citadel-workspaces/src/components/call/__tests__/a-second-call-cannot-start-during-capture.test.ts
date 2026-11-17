/**
 * `startCall` asked "am I busy?" once, before three awaits — the last of which
 * raises the browser's camera permission prompt and can sit there for minutes.
 *
 * The check was added because both call buttons stayed live during an active
 * call, and pressing one "overwrote the live stream and pump without stopping
 * either, leaving the camera light on until a reload while the original peer
 * waited out their 20s silence timeout". But it was placed before
 * `ensureManager`, `ensureSession` and `session.start`, so it answers for a
 * moment that has passed by the time any of the damage is done.
 *
 * The reachable sequence: press Call, leave the permission prompt open, accept
 * an incoming call in another tab-panel. Now busy — and the pending
 * `session.start` resolves onto the SHARED session, replacing the live call's
 * stream and pump, and `manager.start` then overwrites the manager's call state
 * outright, ending the live call for us without telling its peer.
 *
 * `startCall` lives in its own module (start-call.ts) precisely because this
 * rule is not one line. This asserts the shape of the guard rather than driving it, because
 * what was wrong is WHERE the question is asked, and the harness that could
 * observe a permission prompt left open mid-render would be testing React's
 * scheduling rather than this rule. Its limits are stated: it cannot see whether
 * the checks read fresh state, only that they exist on both sides of the awaits.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE: string = readFileSync(
  join(process.cwd(), 'src/components/call/start-call.ts'),
  'utf8',
);

/** The body of startCall, with comments stripped so prose cannot satisfy a check. */
function startCallBody(): string {
  const start: number = SOURCE.indexOf('export async function startCall(');
  expect(start, 'startCall no longer exists; update this test').toBeGreaterThan(-1);
  return SOURCE.slice(start)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('startCall', () => {
  it('asks whether it is busy on both sides of the capture await', () => {
    const body: string = startCallBody();
    const capture: number = body.indexOf('session.start(');
    expect(capture, 'startCall no longer captures media').toBeGreaterThan(-1);

    const before: boolean = body.slice(0, capture).includes('callBusyReason(');
    const after: boolean = body.slice(capture).includes('callBusyReason(');

    expect(before, 'nothing stops a second call before the camera is opened').toBe(true);
    expect(
      after,
      'the busy check is only asked before the awaits, so a call that became \
live during the permission prompt is overwritten by manager.start',
    ).toBe(true);
  });

  it('re-checks between the capture and the announcement', () => {
    // Deliberately "between", not merely "before": the original check sits ahead
    // of every await, so a `lastCheck < announce` assertion would have passed on
    // the defect unchanged. Verified by control — removing both re-checks leaves
    // that weaker form green.
    const body: string = startCallBody();
    const capture: number = body.indexOf('session.start(');
    const announce: number = body.indexOf('manager.start(');
    expect(announce, 'startCall no longer announces the call').toBeGreaterThan(-1);
    const lastCheck: number = body.lastIndexOf('callBusyReason(');

    expect(
      lastCheck > capture && lastCheck < announce,
      'manager.start is reached with no busy check taken after the capture — a call that became live during the permission prompt is overwritten',
    ).toBe(true);
  });

  it('reads the manager’s own state, not the React copy', () => {
    // A call that started milliseconds ago has not necessarily reached this
    // closure yet, and the whole failure is a second start racing the first.
    const body: string = startCallBody();
    const checks: string[] = body.match(/callBusyReason\([^)]*\)/g) ?? [];

    expect(checks.length).toBeGreaterThanOrEqual(2);
    for (const check of checks) {
      expect(check, `${check} does not read the manager's live state`).toContain('managerRef.current');
    }
  });
});
