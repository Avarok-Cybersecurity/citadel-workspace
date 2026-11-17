/**
 * An invitation sent while this person had no tab open is shown when they come back.
 *
 * Found live across two Macs (2026-09-28): the agent only forwarded an invitation to the tab open
 * at that moment, so an invitee who was away found nothing. The agent now keeps it with the
 * session and lists it in `GroupListJoinedSuccess.pending_invites`; this is the UI's half.
 *
 * Real: the wire mapping, the group store's bindings and the pending-invite store. Mocked: the
 * tab's CID (the instance manager's election) and the state request that goes out over the
 * socket -- the two edges this process has no leader tab or socket for.
 */
import { describe, it, expect, vi } from 'vitest';
import { toGroupEvents, type GroupEvent } from '../group-events';
import { noSessionUsername } from '@/test-utils/no-session-username';

vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint { return 100n; } }) };
});
vi.mock('../announce-group-state', () => ({
  sendGroupControl: vi.fn(async (): Promise<string> => 'sent'),
  announceGroupState: vi.fn(),
}));

const SELF: bigint = 100n;
const WAITING: { cid: bigint; mgid: bigint } = { cid: 9n, mgid: 42n };
const JOINED: { cid: bigint; mgid: bigint } = { cid: 9n, mgid: 43n };
const peerName = (cid: bigint): string => (cid === 9n ? 'bob' : cid.toString());

function listed(pending: unknown): GroupEvent[] {
  const body: Record<string, unknown> = { cid: SELF, groups: [JOINED], request_id: null };
  if (pending !== 'absent') body.pending_invites = pending;
  return toGroupEvents({ GroupListJoinedSuccess: body }, SELF, 'alice', peerName);
}

describe('the joined list from an agent that keeps invitations', () => {
  it('turns each waiting invitation into the same event a live one makes, after the joined list', () => {
    const events: GroupEvent[] = listed([{ peer_cid: 9n, group_key: WAITING }]);
    const live: GroupEvent[] = toGroupEvents({ GroupInviteNotification: { cid: SELF, peer_cid: 9n, group_key: WAITING } }, SELF, 'alice', peerName);

    expect(events.map((e: GroupEvent) => e.name)).toEqual(['group:joined-list-received', 'group:invite-received']);
    expect(events[1]).toEqual(live[0]);
    expect(events[1].payload).toMatchObject({ groupId: '9:42', inviterUsername: 'bob' });
  });

  it('is only the joined list from an older agent, which keeps none', () => {
    for (const pending of ['absent', undefined, null]) {
      expect(listed(pending).map((e: GroupEvent) => e.name)).toEqual(['group:joined-list-received']);
    }
  });

  it('reaches the sidebar as a question -- and not for a group already joined', async () => {
    vi.resetModules();
    const store: typeof import('../group-store') = await import('../group-store');
    const invites: typeof import('../group-invites') = await import('../group-invites');
    const { eventEmitter } = await import('@/lib/event-emitter');
    const { toGroupEvents: map } = await import('../group-events');
    store.startGroupEventBindings(noSessionUsername);

    const events: GroupEvent[] = map({
      GroupListJoinedSuccess: {
        cid: SELF, groups: [JOINED], request_id: null,
        pending_invites: [{ peer_cid: 9n, group_key: WAITING }, { peer_cid: 9n, group_key: JOINED }],
      },
    }, SELF, 'alice', peerName);
    for (const event of events) eventEmitter.emit(event.name, event.payload);

    expect(invites.getPendingInvites().map((i: { groupId: string }) => i.groupId)).toEqual(['9:42']);
  });
});
