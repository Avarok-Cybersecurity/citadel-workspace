import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { GroupRole } from '@/types/group';
import type { GroupPermissions } from '@/types/group-permissions';

/** Summarizes a role's enabled permissions into a short display string. */
export function formatPermissions(role: GroupRole): string {
  const perms: GroupPermissions = role.permissions;
  const enabled: string[] = [];

  if (perms.sendMessages) enabled.push('send');
  if (perms.viewMemberList) enabled.push('view');
  if (perms.inviteMembers) enabled.push('invite');
  if (perms.kickMembers) enabled.push('kick');
  if (perms.manageRoles) enabled.push('roles');
  if (perms.assignRoles) enabled.push('assign');
  if (perms.editGroupSettings) enabled.push('settings');
  if (perms.deleteGroup) enabled.push('delete');

  if (enabled.length === 8) return 'All permissions';
  if (enabled.length === 0) return 'No permissions';
  return `Can: ${enabled.join(', ')}`;
}

interface DeleteRoleDialogProps {
  /** Any role with a name: a group's, or the workspace table's (RoleListPanel). */
  roleToDelete: { name: string } | null;
  onOpenChange: () => void;
  onConfirm: () => void;
  /** What happens to its holders; the group's sentence when not given. */
  description?: string;
  /** Inputs the confirmation needs, such as the workspace's required reassign-to picker. */
  children?: ReactNode;
  /** Holds Delete back until those inputs are complete. */
  confirmDisabled?: boolean;
}

/** Checks whether the current user can manage a specific role. */
export function canManageSpecificRole(
  myRoleId: string | undefined,
  canManageRoles: boolean,
  role: GroupRole,
  canManageRoleFn: (myRoleId: string, targetRoleId: string) => boolean,
): boolean {
  if (!myRoleId) return false;
  if (!canManageRoles) return false;
  if (role.isBuiltIn) return false;
  return canManageRoleFn(myRoleId, role.id);
}

/** Confirmation dialog for deleting a group role. */
export function DeleteRoleDialog({
  roleToDelete, onOpenChange, onConfirm, description, children, confirmDisabled,
}: DeleteRoleDialogProps): JSX.Element {
  return (
    <AlertDialog open={!!roleToDelete} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-background border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">
            Delete Role &ldquo;{roleToDelete?.name}&rdquo;?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            {description ?? 'This action cannot be undone. Members with this role will need to be reassigned to another role.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-transparent border-border text-foreground hover:bg-surface">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
