/**
 * KickConfirmDialog sub-component for GroupMemberManagement.
 * Confirmation dialog for kicking a member from a group.
 */

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
import type { GroupMemberWithRole } from '@/types/group';

interface KickConfirmDialogProps {
  member: GroupMemberWithRole | null;
  isKicking: boolean;
  onOpenChange: () => void;
  onConfirm: () => void;
}

export function KickConfirmDialog({
  member,
  isKicking,
  onOpenChange,
  onConfirm,
}: KickConfirmDialogProps): JSX.Element {
  return (
    <AlertDialog open={!!member} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-background border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">
            Kick "{member?.username}"?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            This member will be removed from the group. They can be re-invited
            later by a group admin.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={isKicking}
            className="bg-transparent border-border text-foreground hover:bg-surface"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isKicking}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            {isKicking ? 'Kicking...' : 'Kick Member'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
