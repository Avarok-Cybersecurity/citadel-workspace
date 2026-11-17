/**
 * Records, on this tab's stored session, your role's name and whether you manage roles, so the
 * workspace switcher can show them for an account it is not signed in as: another account's
 * permissions cannot be asked from here.
 *
 * Written from the same answers this tab shows (the role table and the ManageRoles answer), and
 * only once both are known: an unknown is never stored as "not an administrator".
 */
import { useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { usePermission } from '@/hooks/use-permission';
import { confirms, permits, type UsePermissionResult } from '@/hooks/use-permission-result';
import { useRoleDisplay } from '@/hooks/use-workspace-roles';
import { Permission } from '@/lib/permissions-service/types';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { connectionManager } from '@/lib/connection';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import type { StoredSession } from '@/types/session-types';

export function usePersistOwnStanding(roleName: string | null, administers: boolean | null): void {
  useEffect(() => {
    if (roleName === null || administers === null) return;
    runAsyncSetup(async () => {
      const session: StoredSession | null = await connectionManager.getTabSelectedSession();
      if (session) await connectionManager.updateSessionRole(session.username, session.serverAddress, roleName, administers);
    });
  }, [roleName, administers]);
}

/**
 * Whether you are known to administer this workspace (ManageRoles, at the root), persisted for
 * the switcher. The answer TopBar's administrator ring shows: a known yes, never a pending one.
 */
export function useOwnStanding(): boolean {
  const { state } = useWorkspace();
  const manageRoles: UsePermissionResult = usePermission(WORKSPACE_ROOT_ID, Permission.ManageRoles);
  const administers: boolean = confirms(manageRoles);
  const roleName: string | null = useRoleDisplay(state.currentUser?.roleId, state.currentUser?.role)?.name ?? null;
  // A known no is stored as false; a pending answer is not stored at all.
  usePersistOwnStanding(roleName, administers ? true : permits(manageRoles) ? null : false);
  return administers;
}
