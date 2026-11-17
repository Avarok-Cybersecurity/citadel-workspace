/**
 * A follower tab processed another session's group invite and accepted it.
 *
 * One browser holds one WebSocket. The leader tab owns it and broadcasts what
 * it receives; followers filter. The filter was:
 *
 *   if (message.targetCid && tabCid && message.targetCid !== tabCid) return;
 *
 * `targetCid` is stamped by the leader for exactly three types —
 * PeerConnectNotification, PeerRegisterNotification, MessageNotification — so
 * for everything else it is `undefined`, and `undefined &&` never skips. The
 * second gate is `!requestId`, and every group notification is built Rust-side
 * with `request_id: None`, so that passes too.
 *
 * The result, with session A on the leader tab and session B on a follower:
 * a peer invites A to a group, and B's tab emits the invite onto its own bus.
 * B's group-response-service maps it with B's identity and the store
 * auto-accepts — B sees "X invited you to a group", B's sidebar gains a group
 * it was never invited to, and a GroupRespondRequest is sent to the backend
 * with B's cid for an invitation that never named B.
 *
 * The fix reads the notification's OWN cid rather than trusting the leader to
 * have stamped one, which is what CLAUDE.md means by "never process messages
 * where CID doesn't match".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SELF: bigint = 111n;
const OTHER: bigint = 222n;

let selected: { selectedCid: bigint } | null = { selectedCid: SELF };

vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint } | null> => selected,
}));
vi.mock('@/lib/multi-instance', () => ({ instanceManager: { cid: SELF } }));
vi.mock('@/lib/debug-config', () => ({ debugEnabled: false, debugLog: (): void => {} }));

const { handleWorkspaceResponse } = await import('../message-handlers');
const { eventEmitter } = await import('@/lib/event-emitter');

function forwarded(data: Record<string, unknown>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onMessage = (payload: unknown): void => { seen.push(payload); };
  eventEmitter.on('websocket-message', onMessage);
  return handleWorkspaceResponse(
    { type: 'workspace-response', data } as never,
    false,
    () => true,
  ).then(() => {
    eventEmitter.off('websocket-message', onMessage);
    return seen;
  });
}

describe('a follower tab receiving the leader’s broadcast', () => {
  beforeEach((): void => { selected = { selectedCid: SELF }; });

  it('does not forward a group invite addressed to another session', async () => {
    const seen: unknown[] = await forwarded({
      GroupInviteNotification: { cid: OTHER, group_key: { cid: OTHER, mgid: 1n }, request_id: null },
    });

    expect(seen).toEqual([]);
  });

  it('forwards a group invite addressed to this session', async () => {
    // Positive control: a filter that dropped everything would pass above.
    const invite: Record<string, unknown> = {
      GroupInviteNotification: { cid: SELF, group_key: { cid: OTHER, mgid: 1n }, request_id: null },
    };

    const seen: unknown[] = await forwarded(invite);

    expect(seen).toEqual([invite]);
  });

  it('forwards a message that names no session at all', async () => {
    // Not every response is addressed. Dropping these would silence the
    // request/response traffic the follower proxies through the leader.
    const response: Record<string, unknown> = { ListAllPeersResponse: { request_id: 'r1', peers: [] } };

    const seen: unknown[] = await forwarded(response);

    expect(seen).toEqual([response]);
  });

  it('still forwards a deliberate fan-out even when it names a session', async () => {
    // DisconnectNotification is in BROADCAST_MESSAGE_TYPES on purpose: every
    // tab needs to know. A blanket cid filter would break that.
    const disconnect: Record<string, unknown> = { DisconnectNotification: { cid: OTHER, request_id: null } };

    const seen: unknown[] = await forwarded(disconnect);

    expect(seen).toEqual([disconnect]);
  });
});
