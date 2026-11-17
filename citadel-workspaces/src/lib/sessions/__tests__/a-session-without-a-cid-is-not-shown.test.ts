/**
 * A session with no CID must not reach the strip.
 *
 * `ActiveSession.cid` is declared `bigint` and the wire does not always carry
 * one. Such a session cannot be navigated to, claimed, or signed out of —
 * every one of those is keyed by CID — so a chip for it is a control that does
 * nothing.
 *
 * One did reach the strip. Pressing sign-out on it called
 * `disconnect(undefined)`, ran the loading modal through to "ready", and left
 * the chip exactly where it was:
 *
 *   [OrphanSessionsNavbar] Disconnecting session: undefined
 *   prev_sess_b still in navbar: true
 *
 * Dropping is not emptying. A stale list beats an empty one here, which is why
 * a failed READ is never treated as "no sessions"; this removes only the
 * entries nothing can be done with.
 */
import { describe, it, expect } from 'vitest';
import { withWorkspaceNames } from '../with-workspace';
import type { ActiveSession } from '@/types/session-types';

function session(username: string, cid: bigint | undefined): ActiveSession {
  return { username, cid, server_address: '127.0.0.1:12349' } as unknown as ActiveSession;
}

const stored: { username: string; serverAddress: string }[] = [];
const lastAccessed = (): number => 0;

describe('the active-session strip', () => {
  it('drops a session with no CID', () => {
    const paired: ReturnType<typeof withWorkspaceNames> = withWorkspaceNames(
      [session('ada', 42n), session('ghost', undefined)],
      stored,
      lastAccessed,
    );

    expect(paired.map((p) => p.username)).toEqual(['ada']);
  });

  it('keeps CID zero, which is a CID', () => {
    // `0n` is falsy, and a filter written `session.cid` would drop it. Hiding a
    // real session is worse than showing a dead one.
    const paired: ReturnType<typeof withWorkspaceNames> = withWorkspaceNames([session('zero', 0n)], stored, lastAccessed);

    expect(paired.map((p) => p.username)).toEqual(['zero']);
  });

  it('keeps every session when they all have one', () => {
    // The positive control: "drops the bad one" must not be satisfied by a
    // function that drops everything.
    const paired: ReturnType<typeof withWorkspaceNames> = withWorkspaceNames(
      [session('ada', 1n), session('bob', 2n)],
      stored,
      lastAccessed,
    );

    expect(paired.map((p) => p.username).sort()).toEqual(['ada', 'bob']);
  });
});
