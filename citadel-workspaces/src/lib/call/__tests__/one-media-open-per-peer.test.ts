/**
 * Two callers wanting a peer's session open must produce one open, not two.
 *
 * `openSessions` records COMPLETION, so between `transport.openSession(cid)`
 * being called and its promise resolving, the "already open?" guard is false
 * for anybody else. And there are two callers:
 *
 *   - `accept()` opens a session for every peer that has already answered;
 *   - the `CallAccept` handler opens one for the peer that just answered.
 *
 * In a group call those run for the same peer at the same time. The internal
 * service refuses the second:
 *
 *   a media open or teardown is already in progress with this peer; retry shortly
 *
 * and CI reported it as the call failing — `call-group.spec.ts`, all three
 * "decodes frames from TWO distinct peers" cases.
 */
import { describe, it, expect, vi } from 'vitest';
import { openSessionFor } from '../media-session-lifecycle';
import type { CallManagerInternals } from '../call-manager-internals';
import type { CallState } from '../call-state';

const PEER: bigint = 5n;

function internals(openSession: ReturnType<typeof vi.fn>): CallManagerInternals {
  return {
    transport: { openSession, closeSession: vi.fn().mockResolvedValue(undefined) },
    openSessions: new Set<bigint>(),
    openingSessions: new Map<bigint, Promise<void>>(),
    now: () => 0,
    schedule: (fn: () => void) => { void fn; return () => {}; },
    getState: (): CallState | null =>
      ({ status: 'connecting', participants: new Map([[PEER, { cid: PEER }]]) }) as unknown as CallState,
    apply: vi.fn(),
  } as unknown as CallManagerInternals;
}

describe('opening a media session for a peer', () => {
  it('opens once when two callers ask at the same time', async () => {
    // Deliberately slow, so the second call lands inside the first's window --
    // which is the whole window the completion-based guard cannot see.
    let release: () => void = () => {};
    const openSession: ReturnType<typeof vi.fn> = vi.fn(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const m: CallManagerInternals = internals(openSession);

    const first: Promise<void> = openSessionFor(m, PEER, null);
    const second: Promise<void> = openSessionFor(m, PEER, null);
    release();
    await Promise.all([first, second]);

    expect(openSession).toHaveBeenCalledTimes(1);
  });

  it('opens again for a DIFFERENT peer, concurrently', async () => {
    // The positive control. A lock that serialised every peer would make a
    // group call open its sessions one after another, which is the opposite of
    // what accept() does on purpose.
    const openSession: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    const m: CallManagerInternals = internals(openSession);

    await Promise.all([openSessionFor(m, 5n, null), openSessionFor(m, 6n, null)]);

    expect(openSession).toHaveBeenCalledTimes(2);
  });

  it('opens again later, once the first has finished', async () => {
    // The other positive control: the in-flight entry must be cleared, or a
    // peer whose session closes could never be reopened.
    const openSession: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
    const m: CallManagerInternals = internals(openSession);

    await openSessionFor(m, PEER, null);
    m.openSessions.delete(PEER);
    await openSessionFor(m, PEER, null);

    expect(openSession).toHaveBeenCalledTimes(2);
  });
});
