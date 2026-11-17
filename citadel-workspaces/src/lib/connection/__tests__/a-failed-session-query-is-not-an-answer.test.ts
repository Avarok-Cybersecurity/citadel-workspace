/**
 * `getActiveSessions` is how the app decides whether you are logged in.
 *
 * It returned `[]` on every failure — WebSocket init timeout, a tab that cannot
 * send, a GetSessions response that never came, any throw — and then CACHED
 * that empty list as a valid answer. So one timeout produced "you have no
 * sessions" for the whole cache window, without re-asking, across the seven
 * surfaces that consult it.
 *
 * The worst consequence was not cosmetic. WorkspaceLoader concluded there were
 * no sessions, the loading deadline redirected to /connect, and on the way it
 * called `clearSelectedUser()` — a failed READ destroying the tab's session
 * selection. The user then re-authenticated a session that was still alive,
 * which is the SessionAlreadyActive churn the backend notes warn about.
 */

import { describe, it, expect, vi, beforeEach  } from 'vitest';
import { getActiveSessionsResult } from '../queries';
import { pickSessionToClaim , type SessionChoice } from '@/lib/sessions/pick-session-to-claim';
import type { ActiveSessionsResult } from '@/lib/connection/queries';

interface StateDouble {
  cachedSessions: unknown;
  pendingGetSessions: unknown;
  isCacheValid: () => boolean;
  setCachedSessions: (sessions: unknown) => void;
  setPendingGetSessions: (promise: unknown) => void;
  setPendingRequest: (id: string, handlers: unknown) => void;
  hasPendingRequest: (id: string) => boolean;
  deletePendingRequest: (id: string) => void;
  /** What the module under test wrote, for the assertions to read back. */
  cachedForTest: () => unknown;
}

function stateDouble(): StateDouble {
  let cached: unknown = null;
  let pending: unknown = null;
  return {
    get cachedSessions(): unknown { return cached; },
    isCacheValid: (): boolean => cached !== null,
    setCachedSessions: (s: unknown): void => { cached = s; },
    get pendingGetSessions(): unknown { return pending; },
    setPendingGetSessions: (p: unknown): void => { pending = p; },
    setPendingRequest: vi.fn(),
    hasPendingRequest: (): boolean => false,
    deletePendingRequest: vi.fn(),
    cachedForTest: (): unknown => cached,
  };
}

describe('asking which sessions exist', () => {
  let state: ReturnType<typeof stateDouble>;

  beforeEach(() => { state = stateDouble(); });

  it('reports failure rather than emptiness when the tab cannot send', async () => {
    const io: Record<string, unknown> = {
      canSendRequests: (): boolean => false,
      waitForWebSocketInit: (): Promise<void> => Promise.resolve(),
      sendWebSocketMessage: vi.fn(),
    };

    const result: ActiveSessionsResult = await getActiveSessionsResult(state as never, io as never);

    expect(result.ok).toBe(false);
    expect(result.sessions).toEqual([]);
  });

  it('does not cache a failure', async () => {
    const io: Record<string, unknown> = {
      canSendRequests: (): boolean => false,
      waitForWebSocketInit: (): Promise<void> => Promise.resolve(),
      sendWebSocketMessage: vi.fn(),
    };

    await getActiveSessionsResult(state as never, io as never);

    // Caching it is what turned one timeout into a logged-out-looking app for
    // the whole cache window, with every later call answering instantly from
    // the failure without re-asking.
    expect(state.cachedForTest()).toBeNull();
  });

  it('caches a real answer, including a genuinely empty one', async () => {
    const io: Record<string, unknown> = {
      canSendRequests: (): boolean => true,
      waitForWebSocketInit: (): Promise<void> => Promise.resolve(),
      sendWebSocketMessage: vi.fn().mockImplementation(() => {
        // Resolve the pending request the way the response handler would.
        const call: unknown[] = (state.setPendingRequest as ReturnType<typeof vi.fn>).mock.calls[0];
        (call[1] as { resolve: (v: unknown) => void }).resolve({ sessions: [] });
        return Promise.resolve();
      }),
    };

    const result: ActiveSessionsResult = await getActiveSessionsResult(state as never, io as never);

    expect(result.ok).toBe(true);
    expect(state.cachedForTest()).toEqual({ sessions: [], signedOut: [] });
  });
});

describe('choosing a session to claim', () => {
  const live: never[] = [{ cid: 1n }, { cid: 2n }] as never[];

  it('prefers the session this tab had selected', () => {
    expect(pickSessionToClaim(live, 2n).session).toEqual({ cid: 2n });
  });

  it('reports a stale selection instead of clearing it itself', () => {
    // Returned rather than performed: clearing is a destructive write, and only
    // the caller knows whether the list it is comparing against is real.
    const choice: SessionChoice = pickSessionToClaim(live, 99n);

    expect(choice.staleSelection).toBe(true);
    // Never someone else's session in its place. Measured live: bob's tab, whose
    // session the agent had dropped, offered "alice0924 is open in another browser
    // window — Use it here instead?" because this fell back to the first live one.
    expect(choice.session).toBeUndefined();
  });

  it('never calls a selection stale when there is nothing to compare against', () => {
    // The empty list is what a failed query used to produce.
    expect(pickSessionToClaim([], 99n).staleSelection).toBe(false);
  });

  it('resumes the only live session when nothing is remembered, and picks none among several', () => {
    expect(pickSessionToClaim([{ cid: 5n }] as never, undefined).session).toEqual({ cid: 5n });
    expect(pickSessionToClaim([{ cid: 1n }, { cid: 2n }] as never, undefined).session).toBeUndefined();
  });
});

