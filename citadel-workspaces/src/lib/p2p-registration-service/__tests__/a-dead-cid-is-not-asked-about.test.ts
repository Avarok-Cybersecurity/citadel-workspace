/**
 * ListAllPeers and ListRegisteredPeers are not sent for a CID the agent does not hold.
 *
 * On the owner's Mac a tab left open on sessions the agent had dropped earned
 * about twenty thousand ListAllPeers / ListRegisteredPeers refusals for eight
 * CIDs: every poller that lists peers kept asking. The request builders now ask
 * the agent's GetSessions answer first (session-held-gate) and refuse locally,
 * with an error the registration poll treats as the agent's own refusal.
 *
 * The stand-ins are the I/O: the socket send, the cross-tab request registry and
 * the IndexedDB-backed tab context, as in peer-list-reads-a-wire-map. The agent's
 * session list is the one input under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActiveSessionsResult } from '@/lib/connection/queries';
import { isSessionNotFoundRefusal, SessionNotHeldError } from '@/lib/sessions/agent-holds-session';
import { startPeerPoll, type PeerPoll } from '../peer-poll';

const OURS: bigint = 1n;
const h: { sessions: ActiveSessionsResult; sent: unknown[] } = vi.hoisted(() => ({
  sessions: { ok: true, sessions: [], signedOut: [] } as ActiveSessionsResult,
  sent: [] as unknown[],
}));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: { sendMessage: vi.fn((m: unknown) => { h.sent.push(m); return Promise.resolve(); }) },
}));
vi.mock('@/lib/broadcast-channel-service', () => ({
  broadcastChannelService: { registerRequest: vi.fn(), clearRequest: vi.fn() },
}));
vi.mock('@/lib/multi-instance', () => ({ instanceManager: { cid: 1n } }));
vi.mock('@/lib/tab-context', () => ({ getSelectedUser: (): Promise<{ selectedCid: bigint }> => Promise.resolve({ selectedCid: 1n }) }));
vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getConnectionInfo: (): { cid: bigint } => ({ cid: 1n }),
    getTabSelectedSession: (): Promise<{ cid: bigint }> => Promise.resolve({ cid: 1n }),
    getActiveSessionsResult: (): Promise<ActiveSessionsResult> => Promise.resolve(h.sessions),
  },
}));

import { listAllPeers, listRegisteredPeers } from '../discovery';
import { fetchAllPeers, fetchRegisteredPeers } from '@/components/p2p/peer-discovery-requests';

type Pending = Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
const held = (cid: bigint): ActiveSessionsResult['sessions'][number] => ({ cid, username: 'u', server_address: 'a' });

async function answered<T>(call: (pending: Pending) => Promise<T>): Promise<T> {
  const pending: Pending = new Map();
  const result: Promise<T> = call(pending);
  await vi.waitFor((): void => { expect(pending.size).toBe(1); });
  for (const [, entry] of pending) entry.resolve({ peer_information: new Map(), peers: new Map() });
  return result;
}

beforeEach((): void => { h.sent = []; });

describe('a peer list for a session the agent does not hold', () => {
  it.each([
    ['listAllPeers', (p: Pending): Promise<unknown> => listAllPeers(p as never)],
    ['listRegisteredPeers', (p: Pending): Promise<unknown> => listRegisteredPeers(p as never)],
    ['the discovery modal’s ListAllPeers', (): Promise<unknown> => fetchAllPeers(OURS)],
    ['the discovery modal’s ListRegisteredPeers', (): Promise<unknown> => fetchRegisteredPeers(OURS)],
  ])('%s is refused without being sent', async (_name: string, call: (p: Pending) => Promise<unknown>): Promise<void> => {
    h.sessions = { ok: true, sessions: [held(99n)], signedOut: [] };
    const error: unknown = await call(new Map()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SessionNotHeldError);
    expect(isSessionNotFoundRefusal(error)).toBe(true);
    expect(h.sent).toEqual([]);
  });

  it('is sent for a session the agent lists', async (): Promise<void> => {
    h.sessions = { ok: true, sessions: [held(OURS)], signedOut: [] };
    await answered((p: Pending) => listAllPeers(p as never));
    await answered((p: Pending) => listRegisteredPeers(p as never));
    expect(h.sent.map((m: unknown) => Object.keys(m as object)[0])).toEqual(['ListAllPeers', 'ListRegisteredPeers']);
  });

  it('is sent when the agent’s session list could not be read, which is not an answer', async (): Promise<void> => {
    h.sessions = { ok: false, sessions: [], signedOut: [] };
    await answered((p: Pending) => listAllPeers(p as never));
    expect(h.sent).toHaveLength(1);
  });

  it('stops the registration poll, which announces the session gone', async (): Promise<void> => {
    vi.useFakeTimers();
    h.sessions = { ok: true, sessions: [], signedOut: [] };
    const gone: bigint[] = [];
    let checks: number = 0;
    const poll: PeerPoll = startPeerPoll({
      check: async (): Promise<void> => { checks++; await listAllPeers(new Map() as never); },
      currentCid: async (): Promise<bigint | null> => OURS,
      activeSessions: async (): Promise<ActiveSessionsResult> => h.sessions,
      onSessionGone: (cid: bigint): void => { gone.push(cid); },
      onError: (): void => undefined,
    }, 30_000);
    await poll.runNow();
    await vi.advanceTimersByTimeAsync(90_000);
    vi.useRealTimers();
    expect(gone).toEqual([OURS]);
    expect(checks).toBe(1);
    expect(poll.running).toBe(false);
    expect(h.sent).toEqual([]);
  });
});
