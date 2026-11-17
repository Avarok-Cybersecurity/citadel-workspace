/**
 * use-group-state subscribes to six group:* events and nothing emitted any of
 * them, so the group list could never populate. These pin the mapping that
 * fills that gap — response in, events out.
 *
 * The member-state cases pin the REAL wire shape: citadel_types'
 * `MemberState::EnteredGroup { cids }` / `LeftGroup { cids }`. An earlier
 * version of this suite pinned `Joined`/`Kicked` variants that do not exist on
 * the wire, which is precisely how the mapping shipped broken with green tests.
 */
import { describe, it, expect } from 'vitest';
import { toGroupEvents } from '../group-events';
import type { GroupEvent } from '@/lib/group-conversations/group-events';

const SELF: bigint = 100n;
const KEY: { cid: bigint; mgid: bigint; } = { cid: 7n, mgid: 42n };

/** Roster stand-in: names 9n, leaves everyone else to the cid-string fallback. */
const peerName = (cid: bigint): string => (cid === 9n ? 'bob' : cid.toString());

describe('toGroupEvents', () => {
  it('turns GroupCreateSuccess into group:created, which is what adds the group', () => {
    const events: GroupEvent[] = toGroupEvents({ GroupCreateSuccess: { cid: 7n, group_key: KEY } }, SELF, 'alice', peerName);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('group:created');
    expect(events[0].payload).toMatchObject({ groupId: '7:42', ownerId: '7', ownerUsername: 'alice' });
  });

  it('treats GroupChannelCreateSuccess the same way', () => {
    const events: GroupEvent[] = toGroupEvents({ GroupChannelCreateSuccess: { cid: 7n, group_key: KEY } }, SELF, 'alice', peerName);

    expect(events[0]?.name).toBe('group:created');
  });

  it('maps an invite to group:invite-received, naming the inviter from the roster', () => {
    // The wire carries only the inviter's cid. The name matters because the
    // invite handler drops a nameless inviter as malformed — an empty username
    // here silently discarded every invite ever received.
    const events: GroupEvent[] = toGroupEvents(
      { GroupInviteNotification: { cid: SELF, peer_cid: 9n, group_key: KEY } }, SELF, 'alice', peerName,
    );

    expect(events[0]?.name).toBe('group:invite-received');
    expect(events[0]?.payload).toMatchObject({ groupId: '7:42', inviterId: '9', inviterUsername: 'bob' });
  });

  it('maps EnteredGroup to one group:member-joined per member, named from the roster', () => {
    // The notification's own `cid` is the RECIPIENT, not the mover — the
    // members live in the variant's cids list.
    const events: GroupEvent[] = toGroupEvents(
      { GroupMemberStateChangeNotification: { cid: SELF, group_key: KEY, state: { EnteredGroup: { cids: [9n, 11n] } } } },
      SELF, 'alice', peerName,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      name: 'group:member-joined',
      payload: { groupId: '7:42', memberCid: 9n, memberUsername: 'bob' },
    });
    expect(events[1].payload).toMatchObject({ memberCid: 11n, memberUsername: '11' });
  });

  it('maps LeftGroup to group:member-left per member', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupMemberStateChangeNotification: { cid: SELF, group_key: KEY, state: { LeftGroup: { cids: [9n] } } } },
      SELF, 'alice', peerName,
    );

    expect(events).toEqual([
      { name: 'group:member-left', payload: { groupId: '7:42', memberCid: 9n } },
    ]);
  });

  it('accepts member cids that arrived as strings or numbers', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupMemberStateChangeNotification: { cid: SELF, group_key: KEY, state: { EnteredGroup: { cids: ['9', 11] } } } },
      SELF, 'alice', peerName,
    );

    expect(events.map((e) => e.payload.memberCid)).toEqual([9n, 11n]);
  });

  it('maps GroupEndNotification to group:deleted', () => {
    const events: GroupEvent[] = toGroupEvents({ GroupEndNotification: { cid: 7n, group_key: KEY, success: true } }, SELF, 'alice', peerName);

    expect(events).toEqual([{ name: 'group:deleted', payload: { groupId: '7:42' } }]);
  });

  it('maps GroupLeaveNotification to group:member-left', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupLeaveNotification: { cid: 9n, group_key: KEY, success: true, message: '' } }, SELF, 'alice', peerName,
    );

    expect(events[0]?.name).toBe('group:member-left');
    expect(events[0]?.payload).toMatchObject({ memberCid: 9n });
  });

  it('ignores messages that are not group responses', () => {
    expect(toGroupEvents({ PeerRegisterSuccess: { cid: 1n } }, SELF, 'alice', peerName)).toEqual([]);
    expect(toGroupEvents({}, SELF, 'alice', peerName)).toEqual([]);
  });

  it('emits nothing for a member state it does not recognise, rather than guessing', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupMemberStateChangeNotification: { cid: SELF, group_key: KEY, state: { Rekeyed: {} } } }, SELF, 'alice', peerName,
    );

    expect(events).toEqual([]);
  });

  it('propagates a malformed group key instead of emitting a wrong group id', () => {
    expect(() => toGroupEvents({ GroupCreateSuccess: { cid: 7n, group_key: null } }, SELF, 'alice', peerName)).toThrow();
  });
});

/**
 * `GroupEndNotification` is the OWNER's own confirmation. Every other member is
 * told through `GroupDisconnectNotification`, which was handled nowhere — so
 * deleting a group deleted it only for the person who pressed the button. The
 * rest kept it in the sidebar and kept typing into it, and because the server's
 * group messaging has no membership check, those messages still went somewhere.
 *
 * The same notification is how a kicked member learns they were removed.
 */
describe('being removed from a group', () => {
  it('removes the group for a member told through GroupDisconnectNotification', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupDisconnectNotification: { cid: SELF, group_key: KEY } },
      SELF, 'alice', peerName,
    );

    expect(events).toEqual([{ name: 'group:deleted', payload: { groupId: '7:42', byOthers: true } }]);
  });

  it('still removes it for the owner on a successful end', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupEndNotification: { cid: SELF, group_key: KEY, success: true } },
      SELF, 'alice', peerName,
    );

    expect(events).toEqual([{ name: 'group:deleted', payload: { groupId: '7:42' } }]);
  });

  it('does NOT remove it when the end failed', () => {
    // Ignoring `success` meant a failed delete still cleared the group from the
    // sidebar of the only person who could delete it, while it lived on.
    const events: GroupEvent[] = toGroupEvents(
      { GroupEndNotification: { cid: SELF, group_key: KEY, success: false } },
      SELF, 'alice', peerName,
    );

    expect(events).toEqual([]);
  });
});

describe('a leave notification without a cid', () => {
  it('emits nothing rather than removing member zero', () => {
    // `String(left.cid ?? '')` became `BigInt('')` in the handler, which is
    // 0n -- a real cid. So a notification that named nobody removed whoever
    // was member zero.
    const events: GroupEvent[] = toGroupEvents(
      { GroupLeaveNotification: { group_key: KEY } },
      SELF,
      'alice',
      peerName,
    );
    expect(events).toEqual([]);
  });

  it('still emits when the cid is present', () => {
    // Positive control: the guard must not swallow real departures.
    const events: GroupEvent[] = toGroupEvents(
      { GroupLeaveNotification: { group_key: KEY, cid: 9n } },
      SELF,
      'alice',
      peerName,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ memberCid: 9n });
  });
});

describe('the request id on a create success', () => {
  it('is carried through, because the caller correlates on it', () => {
    // Without this the mapping compiles, every other test passes, and
    // `awaitGroupCreated` waits thirty seconds for a payload whose requestId is
    // always undefined. Removing the propagation broke nothing until this
    // existed.
    const events: GroupEvent[] = toGroupEvents(
      { GroupCreateSuccess: { cid: 7n, group_key: KEY, request_id: 'req-1' } },
      SELF,
      'alice',
      peerName,
    );
    expect(events[0]?.payload).toMatchObject({ requestId: 'req-1' });
  });

  it('is undefined rather than invented when the wire omits it', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupCreateSuccess: { cid: 7n, group_key: KEY } },
      SELF,
      'alice',
      peerName,
    );
    expect((events[0]?.payload as { requestId?: string }).requestId).toBeUndefined();
  });
});
