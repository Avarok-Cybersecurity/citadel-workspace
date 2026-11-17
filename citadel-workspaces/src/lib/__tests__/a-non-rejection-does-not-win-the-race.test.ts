import { describe, it, expect } from 'vitest';

/**
 * The pattern `createAccount` races, isolated so it can be tested without a
 * browser or a backend.
 *
 * `createAccount` watches for a rejection toast and races that watcher against
 * "the workspace loaded". The watcher resolves to `{ kind: 'no-error' }` after
 * 15 seconds whenever no toast appears — which is the ordinary SUCCESSFUL case.
 *
 * Raced bare, it therefore BEAT the workspace-loaded signal on any machine
 * where the workspace takes longer than ~15s, and the caller read the outcome
 * as "not loaded". Every integration job on a loaded CI runner failed with
 * "Account registered but its workspace never loaded", and no local run ever
 * did, because locally the workspace loads in a second or two.
 *
 * `Promise.race` does not cancel the loser, which is why the CI log carries the
 * contradiction in plain sight: the failure, and then "Workspace fully loaded"
 * from the waiter that was still running.
 *
 * The rule: an arm that can resolve with a NON-answer must not be allowed to
 * win. The version in `createAccount`'s inner race already did this; the outer
 * one did not.
 */
type Outcome =
  | { kind: 'rejected'; detail: string }
  | { kind: 'no-error'; detail: string }
  | { kind: 'loaded'; detail: string }
  | { kind: 'not-loaded'; detail: string };

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

/** The guarded race, as `createAccount` now performs it. */
function raceOutcome(
  rejection: Promise<{ kind: 'rejected' | 'no-error'; detail: string }>,
  loaded: Promise<boolean>,
): Promise<Outcome> {
  return Promise.race<Outcome>([
    rejection.then((r) => (r.kind === 'rejected' ? r : never<Outcome>())),
    loaded.then((ok) => ({ kind: ok ? ('loaded' as const) : ('not-loaded' as const), detail: '' })),
  ]);
}

const after = <T,>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('the registration outcome race', () => {
  it('does not resolve on "no error" while the workspace is still loading', async () => {
    // The CI shape: the no-error watcher settles first, the workspace later.
    const outcome: Outcome = await raceOutcome(
      after(5, { kind: 'no-error' as const, detail: '' }),
      after(30, true),
    );

    expect(
      outcome.kind,
      'a watcher that found NO error decided the outcome, so a workspace that loads a moment ' +
        'later is reported as never having loaded',
    ).toBe('loaded');
  });

  it('still resolves immediately on a real rejection', async () => {
    // The guard must not cost the thing it was written for: a refused
    // registration must not sit out the full workspace-load timeout.
    const started: number = Date.now();
    const outcome: Outcome = await raceOutcome(
      after(5, { kind: 'rejected' as const, detail: 'username taken' }),
      after(3000, true),
    );

    expect(outcome.kind).toBe('rejected');
    expect(
      Date.now() - started,
      'the rejection arm no longer wins promptly, so a refused registration waits out the ' +
        'whole load timeout',
    ).toBeLessThan(1000);
  });

  it('reports a genuinely unloaded workspace', async () => {
    // The failure this helper exists to detect must still be detectable.
    const outcome: Outcome = await raceOutcome(
      after(5, { kind: 'no-error' as const, detail: '' }),
      after(20, false),
    );

    expect(outcome.kind).toBe('not-loaded');
  });
});
