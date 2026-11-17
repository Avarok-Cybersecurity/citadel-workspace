/**
 * An invitee still ringing when the call went active never got a clock.
 *
 * `observeState` arms liveness the moment the call reaches `active`, then
 * `return`s. The loop it returns past is the one that seeds `invitedSince` —
 * the timestamp `onTick` measures `RING_TIMEOUT_MS` against to evict an invitee
 * who will never answer.
 *
 * In a group call the transition to `active` is exactly the moment some peers
 * are still `invited`: the call becomes active when the FIRST peer connects. So
 * the stragglers present at that instant were skipped, and their clock started
 * only if some later state transition happened to arrive. An invitee whose tab
 * is closed produces no transitions at all — nothing to accept, nothing to
 * decline, no media, no signal. Their own ring timeout is a dial-side guard and
 * does not run here.
 *
 * The result: a participant stuck on "invited" in everyone's roster for the
 * rest of the call, which is precisely the case this clock exists for.
 */
import { describe, it, expect, vi } from 'vitest';
import { CallLivenessBinding } from '../call-liveness-binding';
import { RING_TIMEOUT_MS } from '../call-constants';
import type { CallState } from '../call-state';
import type { CallManagerInternals } from '../call-manager-internals';

const CONNECTED: bigint = 100n;
const STRAGGLER: bigint = 200n;

interface Scheduled { fn: () => void; delayMs: number }

function state(status: CallState['status'], stragglerStatus: string): CallState {
  return {
    status,
    callId: 'call-1',
    participants: new Map([
      [CONNECTED, { cid: CONNECTED, status: 'active' }],
      [STRAGGLER, { cid: STRAGGLER, status: stragglerStatus }],
    ]),
  } as unknown as CallState;
}

interface Harness {
  binding: CallLivenessBinding;
  tick: () => void;
  advance: (ms: number) => void;
  lost: bigint[];
}

function harness(): Harness {
  let clock: number = 0;
  const timers: Scheduled[] = [];
  const lost: bigint[] = [];

  const internals: CallManagerInternals = {
    transport: {
      sendSignal: async (): Promise<void> => undefined,
      closeSession: async (): Promise<void> => undefined,
    },
    openSessions: new Set<bigint>(),
    observedLink: (): undefined => undefined,
    getState: (): CallState => state('active', 'invited'),
    apply: (event: { type: string; cid?: bigint }): void => {
      if (event.type === 'peer-left' && event.cid !== undefined) lost.push(event.cid);
    },
  } as unknown as CallManagerInternals;

  const binding: CallLivenessBinding = new CallLivenessBinding(
    {
      transport: internals.transport,
      now: (): number => clock,
      schedule: (fn: () => void, delayMs: number): (() => void) => {
        timers.push({ fn, delayMs });
        return (): void => { timers.length = 0; };
      },
    },
    () => internals,
  );

  return {
    binding,
    lost,
    advance: (ms: number): void => { clock += ms; },
    tick: (): void => { for (const t of [...timers]) t.fn(); },
  };
}

describe('the moment a group call goes active', () => {
  it('starts the clock for a peer who is still ringing', async (): Promise<void> => {
    const h: Harness = harness();

    // The only transition there is: the first peer connects, the call is active,
    // and the straggler is still `invited`. Nothing else will arrive for them.
    h.binding.observeState(state('active', 'invited'));

    h.advance(RING_TIMEOUT_MS + 1);
    h.tick();
    await Promise.resolve();

    expect(
      h.lost,
      'the straggler was never given a clock, so nothing ever evicts them',
    ).toContain(STRAGGLER);
  });

  it('does not evict a peer who is still within the ring timeout', async (): Promise<void> => {
    // The opposite failure: seeding with a zero timestamp, or evicting on the
    // activation tick itself, would drop invitees who simply have not answered.
    const h: Harness = harness();

    h.binding.observeState(state('active', 'invited'));

    h.advance(RING_TIMEOUT_MS - 1);
    h.tick();
    await Promise.resolve();

    expect(h.lost).not.toContain(STRAGGLER);
  });

  it('does not arm anything while the call is still ringing', async (): Promise<void> => {
    // Arming during `ringing` would evict invitees who have not picked up yet —
    // that is the dial-side ring timeout's job.
    const h: Harness = harness();

    h.binding.observeState(state('ringing' as CallState['status'], 'invited'));

    h.advance(RING_TIMEOUT_MS + 1);
    h.tick();
    await Promise.resolve();

    expect(h.lost).toEqual([]);
  });
});

void vi;
