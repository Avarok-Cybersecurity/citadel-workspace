/**
 * What the role rules need to know about this workspace, gathered once: the table, your own
 * role in it, and the roles the workspace's members hold.
 *
 * Wiring only; the rules are lib/workspace-roles/role-ladder.ts. Each part is null while it is
 * unknown, and the rules read null as "do not withhold", never as "no".
 */
import { useMemo } from 'react';
import type { RoleDefinition, WorkspaceRoles } from 'citadel-workspace-client-ts';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDomainMembers, type DomainMembers } from '@/hooks/use-domain-members';
import { useRoleTable } from '@/hooks/use-workspace-roles';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { actorRole } from '@/lib/workspace-roles/role-ladder';
import type { User as WorkspaceMember } from '@/types/workspace-entities';

export interface RoleLadder {
  table: WorkspaceRoles | null;
  /** Your role; null until both the table and your own role id are known. */
  actor: RoleDefinition | null;
  /** The role ids the workspace's members hold; null while the roster is unknown. */
  memberRoleIds: readonly (string | undefined)[] | null;
  /** The same, as a set, for the vacant-seat rule. */
  occupied: ReadonlySet<string> | null;
}

/** Asks for the workspace roster only while `active`. */
export function useRoleLadder(active: boolean): RoleLadder {
  const { state } = useWorkspace();
  const table: WorkspaceRoles | null = useRoleTable();
  const roster: DomainMembers = useDomainMembers(active ? WORKSPACE_ROOT_ID : null);
  const rosterKnown: boolean = active && !roster.isLoadingMembers && !roster.membersUnavailable;
  const ownRoleId: string | undefined = state.currentUser?.roleId;

  return useMemo((): RoleLadder => {
    const memberRoleIds: (string | undefined)[] | null = rosterKnown
      ? roster.members.map((member: WorkspaceMember): string | undefined => member.roleId)
      : null;
    return {
      table,
      actor: table === null ? null : actorRole(table, ownRoleId),
      memberRoleIds,
      occupied: memberRoleIds === null
        ? null
        : new Set(memberRoleIds.filter((id: string | undefined): id is string => id !== undefined)),
    };
  }, [table, ownRoleId, rosterKnown, roster.members]);
}
