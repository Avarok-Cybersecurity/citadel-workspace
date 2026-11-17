/**
 * AccountConfirmDialogs Component
 *
 * Confirmation dialogs for account management:
 * - Remove single account confirmation
 * - Clear all accounts confirmation
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

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username?: string;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({ open, onOpenChange, username, onConfirm }: DeleteConfirmDialogProps): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-card border-surface">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">Remove Account</AlertDialogTitle>
          <AlertDialogDescription className="text-foreground/80">
            {/*
              Says what it actually does. removeSession() rewrites the saved-session
              list and nothing else: it does not disconnect an active session and it
              does not delete a single stored message. "Remove Account. This action
              cannot be undone." in a product that sells post-quantum security reads
              as "your data is gone", and a user clearing a shared machine would have
              believed it.
            */}
            Remove {username} from the accounts saved on this device? You will need to
            sign in again to use it.
            <span className="mt-2 block">
              Messages already stored on this device are <strong>not</strong> deleted.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-transparent border-border text-foreground/80 hover:bg-accent">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={onConfirm}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface ClearAllConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function ClearAllConfirmDialog({ open, onOpenChange, onConfirm }: ClearAllConfirmDialogProps): JSX.Element {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-card border-surface">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">Clear All Accounts</AlertDialogTitle>
          <AlertDialogDescription className="text-foreground/80">
            {/*
              The twin of the note above, missed when that one was corrected: this said
              "This signs you out and clears the stored credentials". removeAllSessions()
              empties the saved list and nothing else -- live sessions stay signed in
              (measured), and no credentials are stored to clear.
            */}
            Remove every account from the list saved on this device? Accounts that are
            signed in now stay signed in; sign out of one to end it.
            <span className="mt-2 block">
              Messages already stored on this device are <strong>not</strong> deleted.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-transparent border-border text-foreground/80 hover:bg-accent">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={onConfirm}>
            Clear All
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
