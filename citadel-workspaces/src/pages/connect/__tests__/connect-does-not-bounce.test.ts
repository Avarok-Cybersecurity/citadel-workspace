/**
 * The Connect page is where WorkspaceLoader sends a user whose connection died.
 * It must not send them somewhere that sends them back.
 *
 * The old handler tested `session.cid` on the STORED session — which
 * `ConnectionManager.initialize` clears on every load and persists — so the
 * branch was dead and the fallthrough navigated into the workspace with no
 * session. The loader then found zero active sessions, timed out after 5s, and
 * redirected here. A silent bounce, forever.
 *
 * These assert the outcome the caller acts on, not the navigation itself: the
 * page may only route into the workspace when a session was actually adopted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above every top-level binding, so the doubles
// have to live inside vi.hoisted rather than in module scope.
const h: {
  claimSession: ReturnType<typeof vi.fn>;
  postAuthSetup: ReturnType<typeof vi.fn>;
  setSelectedUser: ReturnType<typeof vi.fn>;
  triggerAutoConnect: ReturnType<typeof vi.fn>;
  activeSessions: Array<{ cid: bigint; username: string; server_address: string }>;
  storedSessions: Array<{ username: string; serverAddress: string; password?: string }>;
} = vi.hoisted(() => ({
  claimSession: vi.fn(() => Promise.resolve()),
  postAuthSetup: vi.fn(() => Promise.resolve()),
  setSelectedUser: vi.fn(() => Promise.resolve()),
  triggerAutoConnect: vi.fn(() => Promise.resolve()),
  activeSessions: [] as Array<{ cid: bigint; username: string; server_address: string }>,
  storedSessions: [] as Array<{ username: string; serverAddress: string; password?: string }>,
}));
const { claimSession, postAuthSetup, setSelectedUser, triggerAutoConnect } = h;

vi.mock('@/lib/connection', async (importOriginal: () => Promise<typeof import('@/lib/connection')>) => {
  const real: typeof import('@/lib/connection') = await importOriginal();
  const { doubleOf } = await import('@/test/singleton-double');
  return {
    ...real,
    connectionManager: doubleOf(real.connectionManager, {
      invalidateSessionCache: vi.fn() as never,
      getActiveSessions: vi.fn(() => Promise.resolve(h.activeSessions)) as never,
      getStoredSessionsArray: vi.fn(() => h.storedSessions) as never,
      setActiveSessionIndex: vi.fn(() => Promise.resolve()) as never,
      triggerAutoConnect: h.triggerAutoConnect as never,
    }),
  };
});
vi.mock('@/lib/websocket-service', () => ({ websocketService: { claimSession: h.claimSession } }));
vi.mock('@/lib/post-auth-setup', () => ({ postAuthSetup: h.postAuthSetup }));
vi.mock('@/lib/tab-context', () => ({ setSelectedUser: h.setSelectedUser }));
vi.mock('@/lib/multi-instance', () => ({
  instanceManager: {
    setCid: vi.fn(),
    instanceId: 'this-tab',
    // The claim now asks the registry whether another tab already owns the
    // session, because adopting one that is in use puts two tabs on one CID and
    // sends every CID-routed notification to whichever registered first.
    findInstanceByCid: vi.fn(() => null),
  },
  instanceChannel: { announcePresence: vi.fn() },
}));

import { connectToServer } from '../use-connect-to-server';
import type { ConnectOutcome } from '@/pages/connect/use-connect-to-server';

const SERVER: string = '127.0.0.1:12349';

beforeEach(() => {
  vi.clearAllMocks();
  h.activeSessions = [];
  h.storedSessions = [];
});

describe('connectToServer', () => {
  it('adopts a session that is still live on the internal service', async () => {
    h.activeSessions = [{ cid: 9n, username: 'alice', server_address: SERVER }];

    const outcome: ConnectOutcome = await connectToServer(SERVER);

    expect(outcome).toEqual({ kind: 'connected', cid: 9n });
    expect(claimSession).toHaveBeenCalledWith(9n, true);
    expect(postAuthSetup).toHaveBeenCalledWith(9n);
    // The old claim branch omitted this, leaving the tab's identity for the
    // loader to guess from activeSessions[0] — wrong in a multi-account browser.
    expect(setSelectedUser).toHaveBeenCalledWith(
      expect.objectContaining({ selectedCid: 9n, selectedUsername: 'alice' }),
    );
  });

  it('does not report a connection when nothing is open and nothing is saved', async () => {
    const outcome: ConnectOutcome = await connectToServer(SERVER);

    expect(outcome.kind).toBe('needs-sign-in');
    expect(postAuthSetup).not.toHaveBeenCalled();
  });

  it('does not silently spin when the user declined credential storage', async () => {
    h.storedSessions = [{ username: 'alice', serverAddress: SERVER }];

    const outcome: ConnectOutcome = await connectToServer(SERVER);

    expect(outcome.kind).toBe('needs-sign-in');
    // No point asking auto-connect: it skips password-less sessions.
    expect(triggerAutoConnect).not.toHaveBeenCalled();
    if (outcome.kind === 'needs-sign-in') {
      expect(outcome.reason).toMatch(/credentials were not saved/i);
    }
  });

  it('ignores a live session belonging to a different server', async () => {
    h.activeSessions = [{ cid: 9n, username: 'alice', server_address: 'other.host:12349' }];

    const outcome: ConnectOutcome = await connectToServer(SERVER);

    expect(outcome.kind).toBe('needs-sign-in');
    expect(claimSession).not.toHaveBeenCalled();
  });

  it('treats "not orphaned" as already ours when no other tab holds it', async () => {
    h.activeSessions = [{ cid: 9n, username: 'alice', server_address: SERVER }];
    claimSession.mockRejectedValueOnce(new Error('session is not orphaned'));

    const outcome: ConnectOutcome = await connectToServer(SERVER);

    expect(outcome).toEqual({ kind: 'connected', cid: 9n });
    expect(postAuthSetup).toHaveBeenCalledWith(9n);
  });

  it('refuses to adopt a session another tab is using', async () => {
    const { instanceManager } = await import('@/lib/multi-instance');
    h.activeSessions = [{ cid: 9n, username: 'alice', server_address: SERVER }];
    claimSession.mockRejectedValueOnce(new Error('session is not orphaned'));
    vi.mocked(instanceManager.findInstanceByCid).mockReturnValueOnce('other-tab');

    // Adopting here is what put two tabs on one CID: findInstanceByCid returns
    // the first map hit, so every message, transfer tick and call frame went to
    // one of them while the other showed the same conversation and never moved.
    await expect(connectToServer(SERVER)).rejects.toThrow(/another tab/i);
    expect(postAuthSetup).not.toHaveBeenCalled();
  });
});
