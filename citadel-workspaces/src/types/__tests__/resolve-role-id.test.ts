import { describe, it, expect } from 'vitest';
import { resolveRoleId } from '../group-helpers';
import type { GroupSettings } from '../group-entities';
import type { GroupRole, GroupPermissions } from '../group-permissions';

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

function role(id: string, isDefault: boolean): GroupRole {
  return { id, name: id, color: '#fff', position: 1, isBuiltIn: true, isDefault, permissions: PERMS };
}

function settings(roles: GroupRole[]): GroupSettings {
  return { roles, defaultRoleId: '' } as unknown as GroupSettings;
}

describe('resolveRoleId', () => {
  it('keeps an offered id that names a role we hold', () => {
    expect(resolveRoleId(settings([role('a', false), role('b', true)]), 'a')).toBe('a');
  });

  it('discards an offered id that names nothing here', () => {
    // The whole point: ids are minted per peer, so one from elsewhere resolves
    // to nothing and must not be stored as if it resolved.
    expect(resolveRoleId(settings([role('a', false), role('b', true)]), 'from-another-peer')).toBe('b');
  });

  it('falls back to the default role when none is offered', () => {
    expect(resolveRoleId(settings([role('a', false), role('b', true)]), undefined)).toBe('b');
  });

  it('falls back to the last role by position when no role is marked default', () => {
    // The replaced code indexed `roles[2]`, which was the last element only
    // while there were exactly three defaults. Two roles, and it read
    // undefined -- while typed `string`.
    expect(resolveRoleId(settings([role('a', false), role('b', false)]), undefined)).toBe('b');
    // Four roles: the hard-coded index would have picked the third.
    const four: GroupRole[] = ['a', 'b', 'c', 'd'].map((id) => role(id, false));
    expect(resolveRoleId(settings(four), undefined)).toBe('d');
  });

  it('returns null rather than an undefined typed as a string', () => {
    // `roleId` is declared `string`. With no roles there is no id to give, and
    // `roles[2]?.id` handed back undefined wearing that type.
    expect(resolveRoleId(settings([]), undefined)).toBeNull();
    expect(resolveRoleId(settings([]), 'anything')).toBeNull();
  });
});
