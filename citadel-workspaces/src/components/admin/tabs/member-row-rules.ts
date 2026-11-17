/**
 * What the members tab offers for one member, from the role ladder: which roles the picker
 * lists, whether they are the last member able to manage roles, and whether you may act on them
 * at all. Pure, so the rules are tested without a store; the hook beside it gathers the inputs.
 */
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import {
  assignableRoles, isOnlyManager, mayActOn, roleById,
} from '@/lib/workspace-roles/role-ladder';
import type { MemberRowRules } from './MemberRow';

export const NOT_BELOW_YOU_REASON: string = 'Their role is not below yours, so only someone above them can change it.';

export interface RowLadder {
  table: WorkspaceRoles | null;
  actor: RoleDefinition | null;
  memberRoleIds: readonly (string | undefined)[] | null;
  occupied: ReadonlySet<string> | null;
}

export function memberRowRules(ladder: RowLadder, member: { roleId?: string }, isSelf: boolean): MemberRowRules {
  const { table, actor } = ladder;
  if (table === null) return { roles: null, assignable: new Set(), isOnlyManager: false, actOnBlocked: null };
  const target: RoleDefinition | null = roleById(table, member.roleId);
  return {
    roles: table.roles,
    assignable: new Set(assignableRoles(table, actor, ladder.occupied).map((role: RoleDefinition): string => role.id)),
    isOnlyManager: ladder.memberRoleIds !== null && isOnlyManager(table, ladder.memberRoleIds, member.roleId),
    actOnBlocked: actor !== null && !mayActOn(actor, target, isSelf) ? NOT_BELOW_YOU_REASON : null,
  };
}
