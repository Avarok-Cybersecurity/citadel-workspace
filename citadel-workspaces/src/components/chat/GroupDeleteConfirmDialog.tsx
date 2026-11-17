/**
 * GroupDeleteConfirmDialog Component
 *
 * Confirmation dialog for deleting a group chat.
 * Extracted from GroupSettingsPanel to stay within file size limits.
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

export interface GroupDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  isDeleting: boolean;
  onConfirm: () => void;
}

export function GroupDeleteConfirmDialog({
  open,
  onOpenChange,
  groupName,
  isDeleting,
  onConfirm,
}: GroupDeleteConfirmDialogProps): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-background border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">
            Delete &quot;{groupName}&quot;?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            This action cannot be undone. All messages, members, and settings
            will be permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={isDeleting}
            className="bg-transparent border-border text-foreground hover:bg-surface"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            {isDeleting ? 'Deleting...' : 'Delete Group'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
