/**
 * "We could not check" and "nothing is connected" must not look the same.
 *
 * `getActiveSessions()` returns an empty array when the socket is down or the
 * request times out. `AccountManagementDialog` rendered that as fact: the
 * Active Sessions section disappeared and every saved account lost its "Active"
 * badge and its green border, telling the user positively that nothing was
 * live.
 *
 * `queries.ts` names the hazard where the two accessors are defined — an empty
 * result "does NOT mean there are no sessions, and the two must never be
 * conflated" — and offers `getActiveSessionsResult` for callers that must not.
 * This was one of them and used the lenient one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveSessions, type LiveSessions } from '../account-live-status';

const answer: { ok: boolean; sessions: { cid: bigint; username: string; server_address: string }[]; signedOut: { cid: bigint; username: string; reason: string }[] } = {
  ok: true,
  sessions: [],
  signedOut: [],
};

vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getActiveSessionsResult: vi.fn(async () => answer),
  },
}));

beforeEach((): void => {
  answer.ok = true;
  answer.sessions = [];
  answer.signedOut = [];
});

describe('asking which sessions are live', () => {
  it('starts unknown, before anything has been asked', () => {
    const { result } = renderHook((): LiveSessions => useLiveSessions());

    expect(result.current.sessions).toBeNull();
  });

  it('is null when the query does not answer — not an empty list', async () => {
    // The defect. An empty list is a claim about the accounts; null is a
    // statement about the question.
    //
    // Written first as `act(...).then(() => waitFor(...))`, which passed with
    // the defect deliberately restored: `waitFor` retries until its assertion
    // holds and the FIRST read is the initial `null`, so it succeeded before
    // the state update it was supposed to be watching had landed. A control
    // that cannot fail certifies whatever it is pointed at.
    answer.ok = false;
    answer.sessions = [];

    const { result } = renderHook((): LiveSessions => useLiveSessions());
    await act(async () => { await result.current.load(); });

    expect(result.current.sessions).toBeNull();
  });

  it('is an empty list when the query answers "none"', async () => {
    // The positive control: without it, returning null unconditionally would
    // satisfy the test above.
    answer.ok = true;
    answer.sessions = [];

    const { result } = renderHook((): LiveSessions => useLiveSessions());
    await act(async () => { await result.current.load(); });

    expect(result.current.sessions).toEqual([]);
  });

  it('carries the sessions through when there are some', async () => {
    answer.ok = true;
    answer.sessions = [{ cid: 7n, username: 'alice', server_address: 'x:1' }];

    const { result } = renderHook((): LiveSessions => useLiveSessions());
    await act(async () => { await result.current.load(); });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions?.[0].username).toBe('alice');
  });

  it('carries the signed-out accounts from an answer, and none from a failure', async () => {
    const gaveUp: { cid: bigint; username: string; reason: string } = { cid: 7n, username: 'alice', reason: 'CID not registered to this node' };
    answer.signedOut = [gaveUp];
    const { result } = renderHook((): LiveSessions => useLiveSessions());
    await act(async () => { await result.current.load(); });
    expect(result.current.signedOut).toEqual([gaveUp]);

    answer.ok = false;
    await act(async () => { await result.current.load(); });
    expect(result.current.signedOut).toEqual([]);
  });
});
