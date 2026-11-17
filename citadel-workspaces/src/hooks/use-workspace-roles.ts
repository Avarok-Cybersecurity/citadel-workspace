/**
 * The workspace's role table, asked for once per session when something first needs it.
 *
 * Wiring only: the state and its transitions are lib/workspace-roles/roles-store.ts, tested
 * without React; the request goes through rolesApi, the one I/O boundary.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { WorkspaceRoles } from 'citadel-workspace-client-ts';
import { getRolesState, requestRoles, subscribeRoles, type RolesState } from '@/lib/workspace-roles/roles-store';
import { rolesApi } from '@/lib/workspace-roles/roles-api';
import { displayRole, type RoleDisplay } from '@/lib/workspace-roles/role-display';

export function useWorkspaceRoles(): RolesState {
  const state: RolesState = useSyncExternalStore(subscribeRoles, getRolesState);
  useEffect(() => {
    if (state.status === 'unknown') requestRoles(rolesApi.list);
  }, [state.status]);
  return state;
}

/** The table once it has arrived; null while it is unknown, loading or failed. */
export function useRoleTable(): WorkspaceRoles | null {
  const state: RolesState = useWorkspaceRoles();
  return state.status === 'loaded' ? state.table : null;
}

/** Ask again after a failure. */
export function retryRoles(): void {
  requestRoles(rolesApi.list);
}

/** How to show the role `roleId` names, falling back to the legacy mirror; see role-display. */
export function useRoleDisplay(roleId: string | null | undefined, legacy: unknown): RoleDisplay | null {
  return displayRole(useRoleTable(), roleId, legacy);
}
