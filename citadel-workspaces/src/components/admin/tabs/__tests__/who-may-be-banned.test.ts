/**
 * Whom the members tab offers to ban: never yourself, never the Owner, and nobody at or above
 * you, as the server rules; the last member able to manage roles is held back too.
 */
import { describe, expect, it } from 'vitest';
import { LAST_MANAGER_REASON } from '../MemberRow';
import { memberRowRules, NOT_BELOW_YOU_REASON, OWNER_BAN_REASON, SELF_BAN_REASON, type RowLadder } from '../member-row-rules';
import { SEED } from '@/test-utils/role-table';

function ladder(actorId: string, memberRoleIds: string[]): RowLadder {
  return { table: SEED, actor: SEED.roles.find((r) => r.id === actorId) ?? null, memberRoleIds, occupied: new Set(memberRoleIds) };
}

describe('banBlocked', () => {
  it('lets an Admin ban a Member', () => {
    expect(memberRowRules(ladder('admin', ['owner', 'admin', 'member']), { roleId: 'member' }, false).banBlocked).toBeNull();
  });
  it('refuses yourself, the Owner, and anyone not below you', () => {
    expect(memberRowRules(ladder('admin', ['owner', 'admin']), { roleId: 'admin' }, true).banBlocked).toBe(SELF_BAN_REASON);
    expect(memberRowRules(ladder('owner', ['owner', 'admin']), { roleId: 'owner' }, false).banBlocked).toBe(OWNER_BAN_REASON);
    expect(memberRowRules(ladder('admin', ['owner', 'admin', 'admin']), { roleId: 'admin' }, false).banBlocked).toBe(NOT_BELOW_YOU_REASON);
  });
  it('holds back the last member able to manage roles', () => {
    expect(memberRowRules(ladder('owner', ['owner', 'admin']), { roleId: 'admin' }, false).banBlocked).toBeNull();
    expect(memberRowRules(ladder('owner', ['admin']), { roleId: 'admin' }, false).banBlocked).toBe(LAST_MANAGER_REASON);
  });
});
