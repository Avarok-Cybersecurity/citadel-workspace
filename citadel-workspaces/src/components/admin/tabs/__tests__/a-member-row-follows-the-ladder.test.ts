/**
 * What the members tab offers for one member: the roles you may hand out, whether they are the
 * last member who can manage roles (so demoting or removing them is held back), and whether
 * their role is below yours at all. Asked of permissions and positions, never of names.
 */
import { describe, expect, it } from 'vitest';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';
import { memberRowRules, NOT_BELOW_YOU_REASON, type RowLadder } from '../member-row-rules';
import type { MemberRowRules } from '../MemberRow';
import { ADMIN, GUEST, MEMBER, OWNER, SEED, tableOf } from '@/test-utils/role-table';

function ladder(actorId: string | null, memberRoleIds: string[] | null, table: WorkspaceRoles = SEED): RowLadder {
  return {
    table,
    actor: table.roles.find((r) => r.id === actorId) ?? null,
    memberRoleIds,
    occupied: memberRoleIds === null ? null : new Set(memberRoleIds),
  };
}

describe('memberRowRules', () => {
  it('offers an Admin the roles below them and the vacant Owner seat, and lets them act on a Member', () => {
    const rules: MemberRowRules = memberRowRules(ladder('admin', ['admin', 'member']), { roleId: 'member' }, false);
    expect([...rules.assignable].sort()).toEqual(['guest', 'member', 'owner']);
    expect(rules.actOnBlocked).toBeNull();
    expect(rules.isOnlyManager).toBe(false);
  });

  it('holds back a member whose role is not below yours', () => {
    expect(memberRowRules(ladder('admin', ['admin', 'owner']), { roleId: 'owner' }, false).actOnBlocked).toBe(NOT_BELOW_YOU_REASON);
    expect(memberRowRules(ladder('admin', ['admin']), { roleId: 'admin' }, false).actOnBlocked).toBe(NOT_BELOW_YOU_REASON);
  });

  it('never holds you back from yourself', () => {
    expect(memberRowRules(ladder('admin', ['admin']), { roleId: 'admin' }, true).actOnBlocked).toBeNull();
  });

  it('marks the last member able to manage roles, and only them', () => {
    expect(memberRowRules(ladder('admin', ['admin', 'member']), { roleId: 'admin' }, true).isOnlyManager).toBe(true);
    expect(memberRowRules(ladder('admin', ['admin', 'owner']), { roleId: 'admin' }, true).isOnlyManager).toBe(false);
  });

  it('counts by permission: a renamed Admin is still the last manager', () => {
    const renamed: WorkspaceRoles = tableOf(OWNER, { ...ADMIN, name: 'Stewards' }, { ...MEMBER, name: 'Admin' }, GUEST);
    expect(memberRowRules(ladder('admin', ['admin', 'member'], renamed), { roleId: 'admin' }, true).isOnlyManager).toBe(true);
    expect(memberRowRules(ladder('admin', ['admin', 'member'], renamed), { roleId: 'member' }, false).isOnlyManager).toBe(false);
  });

  it('withholds nothing while the roster or your own role is unknown, and offers no roles before the table', () => {
    const unknownRoster: MemberRowRules = memberRowRules(ladder('admin', null), { roleId: 'admin' }, true);
    expect(unknownRoster.isOnlyManager).toBe(false);
    const unknownActor: MemberRowRules = memberRowRules(ladder(null, ['admin']), { roleId: 'admin' }, false);
    expect(unknownActor.actOnBlocked).toBeNull();
    expect(memberRowRules({ table: null, actor: null, memberRoleIds: null, occupied: null }, { roleId: 'admin' }, false).roles).toBeNull();
  });
});
