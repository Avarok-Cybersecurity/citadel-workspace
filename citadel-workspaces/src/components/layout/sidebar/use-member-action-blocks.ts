/**
 * The member-action gate for one domain, from your ManageRoles answer at the workspace and your
 * RemoveUsers answer there.
 *
 * Wiring only: the rule is `memberActionBlocks`, tested without a store.
 */
import { Permission } from '@/contexts/PermissionsContext';
import { usePermission } from '@/hooks/use-permission';
import { WORKSPACE_ROOT_ID } from '@/lib/workspace-constants';
import { memberActionBlocks, type MemberActionBlocks } from './member-actions-gate';

export function useMemberActionBlocks(domainId: string): MemberActionBlocks {
  return memberActionBlocks(
    usePermission(WORKSPACE_ROOT_ID, Permission.ManageRoles),
    usePermission(domainId, Permission.RemoveUsers),
  );
}
