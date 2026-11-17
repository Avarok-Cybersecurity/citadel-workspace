import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGroupRoles } from '../use-group-roles';
import type { GroupConversation, GroupSettings } from '@/types/group-entities';
import type { GroupRole, GroupPermissions } from '@/types/group-permissions';

const PERMS: GroupPermissions = {
  sendMessages: true,
  viewMemberList: true,
  inviteMembers: false,
  kickMembers: false,
  manageRoles: false,
  assignRoles: false,
  editGroupSettings: false,
  deleteGroup: false,
};

function role(id: string, isDefault: boolean, isBuiltIn: boolean): GroupRole {
  return { id, name: id, color: '#fff', position: 1, isBuiltIn, isDefault, permissions: PERMS };
}

function groupWith(roles: GroupRole[]): GroupConversation {
  return {
    id: 'g1',
    name: 'Design',
    ownerId: 1n,
    members: [],
    settings: { roles, defaultRoleId: roles.find((r) => r.isDefault)?.id ?? '' },
    unreadCount: 0,
  } as unknown as GroupConversation;
}

describe('editing a role', () => {
  it('does not write through to the roles it was given', () => {
    // The map returns the ORIGINAL object for every role it is not editing, so
    // clearing `isDefault` in place reached the caller's own array: the
    // settings the store holds, props a memoized child compares by reference,
    // the copy already read out of persistence -- all changed with no state
    // update to announce it.
    const wasDefault: GroupRole = role('old-default', true, false);
    const target: GroupRole = role('custom', false, false);
    const group: GroupConversation = groupWith([wasDefault, target]);

    const { result } = renderHook(() => useGroupRoles(group, () => {}));
    const next: GroupSettings = result.current.updateRole('custom', { isDefault: true });

    // The returned settings are correct...
    expect(next.roles.find((r) => r.id === 'custom')?.isDefault).toBe(true);
    expect(next.roles.find((r) => r.id === 'old-default')?.isDefault).toBe(false);
    expect(next.defaultRoleId).toBe('custom');

    // ...and the objects handed in are untouched.
    expect(wasDefault.isDefault).toBe(true);
    expect(group.settings.roles.find((r) => r.id === 'old-default')?.isDefault).toBe(true);
  });

  it('leaves a default in place when the edit could not set one', () => {
    // A built-in role keeps everything but its name and colour, so asking to
    // make one default changes nothing about it. Clearing the others on the
    // strength of the request alone left the group with NO default role.
    const builtIn: GroupRole = role('member', false, true);
    const someDefault: GroupRole = role('other', true, false);
    const group: GroupConversation = groupWith([builtIn, someDefault]);

    const { result } = renderHook(() => useGroupRoles(group, () => {}));
    const next: GroupSettings = result.current.updateRole('member', { isDefault: true });

    expect(next.roles.some((r) => r.isDefault)).toBe(true);
    expect(next.roles.find((r) => r.id === 'other')?.isDefault).toBe(true);
  });

  it('still moves the default when the target really becomes one', () => {
    // Positive control: the guard must not block a legitimate change.
    const oldOne: GroupRole = role('old', true, false);
    const newOne: GroupRole = role('new', false, false);
    const { result } = renderHook(() => useGroupRoles(groupWith([oldOne, newOne]), () => {}));
    const next: GroupSettings = result.current.updateRole('new', { isDefault: true });
    expect(next.roles.filter((r) => r.isDefault).map((r) => r.id)).toEqual(['new']);
  });
});
