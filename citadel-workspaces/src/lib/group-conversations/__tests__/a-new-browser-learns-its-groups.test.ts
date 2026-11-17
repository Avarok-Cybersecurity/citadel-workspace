/**
 * A member signing in from a new browser sees the groups they are in.
 *
 * The group list lives in the browser. Live, Lara and Max signed in to a fresh
 * browser and both saw "No conversations yet" while both were in Sweep Group:
 * nothing told the UI about a group it had not watched being created or
 * joined. The agent now lists the session's groups (GroupListJoined), and the
 * SDK's own re-opened channel for a JOINED group says the same thing.
 *
 * A learnt group has only what its key says -- the owner -- so it asks the
 * group for its state, and adopts the first snapshot a member sends.
 */
import { describe, it, expect } from 'vitest';
import { toGroupEvents, type GroupEvent } from '../group-events';
import { addJoinedGroups, shouldAnswerStateRequest } from '../learn-joined-groups';
import { applyGroupControl } from '../apply-group-control';
import { decodeGroupControl, encodeGroupControl } from '../group-control-codec';
import { groupControlSnapshot } from '../announce-group-state';
import { createDefaultRoles } from '@/types/group';
import type { GroupConversation, GroupRole } from '@/types/group';

const SELF: bigint = 100n;
const OWNER: bigint = 7n;
const peerName = (cid: bigint): string => `user${cid}`;

describe('learning the groups a session is in', () => {
  it('maps GroupListJoinedSuccess to the joined list', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupListJoinedSuccess: { cid: SELF, groups: [{ cid: OWNER, mgid: 42n }, { cid: SELF, mgid: 1n }], request_id: null } },
      SELF, 'self', peerName,
    );
    expect(events).toEqual([{ name: 'group:joined-list-received', payload: { groupIds: ['7:42', '100:1'] } }]);
  });

  it("treats the SDK re-opening a joined group's channel as a joined group, not one this session created", () => {
    const events: GroupEvent[] = toGroupEvents({ GroupChannelCreateSuccess: { cid: SELF, group_key: { cid: OWNER, mgid: 42n } } }, SELF, 'self', peerName);
    expect(events).toEqual([{ name: 'group:joined-list-received', payload: { groupIds: ['7:42'] } }]);
  });

  it('adds each unknown group, owned by the key, awaiting its state', () => {
    const [group] = addJoinedGroups([], ['7:42'], SELF, 'self', peerName);
    expect(group).toMatchObject({ id: '7:42', ownerId: OWNER, awaitingState: true });
    expect(group.members.map((m) => m.cid)).toEqual([OWNER, SELF]);
  });

  it('leaves groups it already holds, and hands back the same list when nothing is new', () => {
    const known: GroupConversation[] = addJoinedGroups([], ['7:42'], SELF, 'self', peerName);
    expect(addJoinedGroups(known, ['7:42'], SELF, 'self', peerName)).toBe(known);
    expect(addJoinedGroups(known, ['not-a-key'], SELF, 'self', peerName)).toBe(known);
  });
});

describe('the state a learnt group asks for', () => {
  // One set: createDefaultRoles mints fresh role ids on every call.
  const roles: GroupRole[] = createDefaultRoles();
  const full: GroupConversation = {
    id: '7:42', name: 'Sweep Group', ownerId: OWNER, unreadCount: 0,
    settings: { roles, defaultRoleId: roles[2].id },
    members: [
      { cid: OWNER, username: 'user7', roleId: roles[0].id, joinedAt: 1 },
      { cid: SELF, username: 'self', roleId: roles[2].id, joinedAt: 1 },
      { cid: 9n, username: 'user9', roleId: roles[1].id, joinedAt: 1 },
    ],
  };

  it('asks with a control message that survives the codec', () => {
    const bytes: Uint8Array = encodeGroupControl({ group_id: '7:42', message_id: 'm', sender_cid: SELF, timestamp: 1, control: { request_state: true } });
    expect(decodeGroupControl(bytes)?.control).toEqual({ request_state: true });
  });

  it('adopts the first snapshot a member sends, roster included, and stops awaiting', () => {
    const learnt: GroupConversation[] = addJoinedGroups([], ['7:42'], SELF, 'self', peerName);
    const [after] = applyGroupControl(learnt, { groupId: '7:42', senderCid: 9n, ownerCid: OWNER, control: groupControlSnapshot(full) }, peerName);
    expect(after.name).toBe('Sweep Group');
    expect(after.members.map((m) => [m.cid, m.roleId])).toEqual(full.members.map((m) => [m.cid, m.roleId]));
    expect(after.settings).toEqual(full.settings);
    expect(after.awaitingState).toBeUndefined();
  });

  it('judges a snapshot for a group it already holds by the usual rules', () => {
    // 9n is a plain Member here, and a Member may not rename: adoption is for learnt groups only.
    const held: GroupConversation[] = [{ ...full, name: 'Kept', members: full.members.map((m) => (m.cid === 9n ? { ...m, roleId: full.settings.defaultRoleId } : m)) }];
    const [after] = applyGroupControl(held, { groupId: '7:42', senderCid: 9n, ownerCid: OWNER, control: { name: 'Renamed' } }, peerName);
    expect(after.name).toBe('Kept');
  });

  it('is answered by a member holding the group, never by itself or by a group still waiting', () => {
    expect(shouldAnswerStateRequest(full, 9n, SELF)).toBe(true);
    expect(shouldAnswerStateRequest(full, SELF, SELF)).toBe(false);
    expect(shouldAnswerStateRequest({ ...full, awaitingState: true }, 9n, SELF)).toBe(false);
    expect(shouldAnswerStateRequest(undefined, 9n, SELF)).toBe(false);
  });
});
