/**
 * A control message changes only what its sender's role permits, judged on
 * the RECEIVER's copy of the roles. The owner (the cid the group key names) is
 * always permitted; everyone else also stays below their own role.
 */
import { describe, it, expect } from 'vitest';
import { applyGroupControl } from '../apply-group-control';
import type { GroupControlEvent } from '../peer-group-control-inbound';
import type { GroupControlBody } from '../group-control-codec';
import { createDefaultRoles, type GroupConversation, type GroupRole, type GroupSettings } from '@/types/group';

const OWNER: bigint = 11n;
const ADMIN: bigint = 22n;
const MEMBER: bigint = 33n;
const STRANGER: bigint = 44n;
const ID: string = `${OWNER}:5`;

function receiverCopy(): GroupConversation {
  const roles: GroupRole[] = createDefaultRoles();
  const [owner, admin, member] = roles;
  return {
    id: ID,
    name: 'Old',
    ownerId: OWNER,
    members: [
      { cid: OWNER, username: 'o', roleId: owner.id, joinedAt: 0 },
      { cid: ADMIN, username: 'a', roleId: admin.id, joinedAt: 0 },
      { cid: MEMBER, username: 'm', roleId: member.id, joinedAt: 0 },
    ],
    settings: { roles, defaultRoleId: member.id },
    unreadCount: 0,
  };
}

const from = (sender: bigint, control: GroupControlBody): GroupControlEvent => ({ groupId: ID, senderCid: sender, ownerCid: OWNER, control });
// These groups are all held, never learnt, so no member is ever added and no name is looked up;
// throwing proves it rather than hiding a lookup behind a stand-in name.
const noLookup = (cid: bigint): string => { throw new Error(`a held group looked up member ${cid}`); };
const apply = (group: GroupConversation, event: GroupControlEvent): GroupConversation => applyGroupControl([group], event, noLookup)[0];
const roleOf = (group: GroupConversation, cid: bigint): GroupRole | undefined =>
  group.settings.roles.find((r) => r.id === group.members.find((m) => m.cid === cid)?.roleId);

describe('renaming', () => {
  it('takes the owner\'s name', () => {
    expect(apply(receiverCopy(), from(OWNER, { name: 'New' })).name).toBe('New');
  });

  it('takes an admin\'s, whose role here may edit settings', () => {
    expect(apply(receiverCopy(), from(ADMIN, { name: 'New' })).name).toBe('New');
  });

  it('refuses a plain member\'s', () => {
    expect(apply(receiverCopy(), from(MEMBER, { name: 'Pwned' })).name).toBe('Old');
  });

  it('refuses someone who is not a member here at all', () => {
    expect(apply(receiverCopy(), from(STRANGER, { name: 'Pwned' })).name).toBe('Old');
  });
});

describe('roles and assignments from the owner', () => {
  it('replaces this copy\'s roles and places every member by the owner\'s ids', () => {
    const ownersRoles: GroupRole[] = createDefaultRoles();
    const settings: GroupSettings = { roles: ownersRoles, defaultRoleId: ownersRoles[2].id };
    const next: GroupConversation = apply(receiverCopy(), from(OWNER, {
      settings,
      assignments: [
        { cid: OWNER, role_id: ownersRoles[0].id },
        { cid: MEMBER, role_id: ownersRoles[1].id },
      ],
    }));
    expect(next.settings.roles.map((r) => r.id)).toEqual(ownersRoles.map((r) => r.id));
    expect(roleOf(next, MEMBER)?.name).toBe('Admin');
    // Not in the assignments, and its old role id no longer exists: the default.
    expect(roleOf(next, ADMIN)?.id).toBe(ownersRoles[2].id);
  });
});

describe('what a non-owner cannot do', () => {
  it('a member cannot assign roles', () => {
    const group: GroupConversation = receiverCopy();
    const adminRole: string = group.settings.roles[1].id;
    expect(roleOf(apply(group, from(MEMBER, { assignments: [{ cid: MEMBER, role_id: adminRole }] })), MEMBER)?.name).toBe('Member');
  });

  it('an admin can promote a member to below themselves, but not to Owner', () => {
    const group: GroupConversation = receiverCopy();
    const [owner] = group.settings.roles;
    const next: GroupConversation = apply(group, from(ADMIN, { assignments: [{ cid: MEMBER, role_id: owner.id }, { cid: ADMIN, role_id: owner.id }] }));
    expect(roleOf(next, MEMBER)?.name).toBe('Member');
    expect(roleOf(next, ADMIN)?.name).toBe('Admin');
  });

  it('an admin cannot demote the owner', () => {
    const group: GroupConversation = receiverCopy();
    const memberRole: string = group.settings.roles[2].id;
    expect(roleOf(apply(group, from(ADMIN, { assignments: [{ cid: OWNER, role_id: memberRole }] })), OWNER)?.name).toBe('Owner');
  });

  it('an admin cannot grant its own role more power', () => {
    const group: GroupConversation = receiverCopy();
    const roles: GroupRole[] = group.settings.roles.map((r) =>
      r.name === 'Admin' ? { ...r, permissions: { ...r.permissions, deleteGroup: true } } : r);
    const next: GroupConversation = apply(group, from(ADMIN, { settings: { ...group.settings, roles } }));
    expect(roleOf(next, ADMIN)?.permissions.deleteGroup).toBe(false);
  });

  it('an admin can change a role below its own', () => {
    const group: GroupConversation = receiverCopy();
    const roles: GroupRole[] = group.settings.roles.map((r) => (r.name === 'Member' ? { ...r, name: 'Guest' } : r));
    expect(roleOf(apply(group, from(ADMIN, { settings: { ...group.settings, roles } })), MEMBER)?.name).toBe('Guest');
  });

  it('a member cannot redefine roles at all', () => {
    const group: GroupConversation = receiverCopy();
    const roles: GroupRole[] = group.settings.roles.map((r) => (r.name === 'Member' ? { ...r, permissions: { ...r.permissions, kickMembers: true } } : r));
    expect(roleOf(apply(group, from(MEMBER, { settings: { ...group.settings, roles } })), MEMBER)?.permissions.kickMembers).toBe(false);
  });
});

describe('the store contract', () => {
  it('returns the same list when nothing changes', () => {
    const groups: GroupConversation[] = [receiverCopy()];
    const g: GroupConversation = groups[0];
    const same: GroupControlBody = {
      name: g.name,
      settings: { ...g.settings, roles: g.settings.roles.map((r) => ({ ...r })) },
      assignments: g.members.map((m) => ({ cid: m.cid, role_id: m.roleId })),
    };
    expect(applyGroupControl(groups, from(OWNER, same), noLookup)).toBe(groups);
  });

  it('never creates a group it does not have', () => {
    const groups: GroupConversation[] = [];
    expect(applyGroupControl(groups, from(OWNER, { name: 'X' }), noLookup)).toBe(groups);
  });
});
