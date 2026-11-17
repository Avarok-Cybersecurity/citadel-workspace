/**
 * A media session confirmed after the call ended was registered and never
 * closed.
 *
 * `openSessionOnce` awaits `transport.openSession(cid)`, then adds the peer to
 * `openSessions` and applies `peer-connected`. Opening a session is a real
 * round trip to the internal service with a connect budget measured in tens of
 * seconds, and the call can end — hung up, declined, failed — at any point
 * inside it.
 *
 * The FAILURE path already knows this: it re-reads the state after the await
 * and returns if the call is `ended` or `failed`, because "a call that ended
 * while we were waiting has nothing left to open a session for". The SUCCESS
 * path never re-read anything. So a late-confirming open:
 *
 *   - added the peer to `openSessions` after `closeAllSessions` had already run,
 *     leaving a live media session on the service that nothing would ever close
 *     — a camera and a UDP channel held open until the page was closed;
 *   - applied `peer-connected` to a call that had ended, which is the event that
 *     moves a call to `active` and starts the duration clock.
 *
 * The window is the whole open. It is not a narrow race.
 */
import { describe, it, expect, vi } from 'vitest';
import { openSessionFor } from '../media-session-lifecycle';
import type { CallManagerInternals } from '../call-manager-internals';
import type { CallState, CallEvent } from '../call-state';

const PEER: bigint = 900n;

interface Harness {
  m: CallManagerInternals;
  applied: CallEvent[];
  closed: bigint[];
  resolveOpen: () => void;
  setStatus: (status: CallState['status']) => void;
}

function harness(): Harness {
  const applied: CallEvent[] = [];
  const closed: bigint[] = [];
  let resolveOpen: () => void = (): void => {};
  const opened: Promise<void> = new Promise<void>((resolve) => { resolveOpen = resolve; });

  let status: CallState['status'] = 'connecting';
  const state = (): CallState => ({
    status,
    participants: new Map([[PEER, { cid: PEER, status: 'connecting' }]]),
  }) as unknown as CallState;

  const m: CallManagerInternals = {
    transport: {
      openSession: (): Promise<void> => opened,
      closeSession: async (cid: bigint): Promise<void> => { closed.push(cid); },
    },
    openSessions: new Set<bigint>(),
    openingSessions: new Map<bigint, Promise<void>>(),
    now: (): number => 0,
    getState: (): CallState | null => state(),
    apply: (event: CallEvent): void => { applied.push(event); },
  } as unknown as CallManagerInternals;

  return { m, applied, closed, resolveOpen, setStatus: (s): void => { status = s; } };
}

describe('a media session that opens after the call is over', () => {
  it('is closed rather than registered', async (): Promise<void> => {
    const h: Harness = harness();
    const pending: Promise<void> = openSessionFor(h.m, PEER, null);

    h.setStatus('ended');
    h.resolveOpen();
    await pending;

    expect([...h.m.openSessions], 'a session nothing will ever close').toEqual([]);
    expect(h.closed, 'the late session was left open on the service').toEqual([PEER]);
  });

  it('does not report the peer as connected', async (): Promise<void> => {
    // `peer-connected` is what moves a call to 'active' and starts the duration
    // clock. Applying it to an ended call revives it in the UI.
    const h: Harness = harness();
    const pending: Promise<void> = openSessionFor(h.m, PEER, null);

    h.setStatus('ended');
    h.resolveOpen();
    await pending;

    expect(h.applied).toEqual([]);
  });

  it('treats a failed call the same as an ended one', async (): Promise<void> => {
    const h: Harness = harness();
    const pending: Promise<void> = openSessionFor(h.m, PEER, null);

    h.setStatus('failed');
    h.resolveOpen();
    await pending;

    expect([...h.m.openSessions]).toEqual([]);
    expect(h.applied).toEqual([]);
  });

  it('still registers and reports a session that opens during a live call', async (): Promise<void> => {
    // The opposite failure: refusing to register on the success path would make
    // every call silently medialess, and both assertions above would still pass.
    const h: Harness = harness();
    const pending: Promise<void> = openSessionFor(h.m, PEER, null);

    h.resolveOpen();
    await pending;

    expect([...h.m.openSessions]).toEqual([PEER]);
    expect(h.applied).toEqual([{ type: 'peer-connected', cid: PEER }]);
    expect(h.closed).toEqual([]);
  });
});

void vi;
