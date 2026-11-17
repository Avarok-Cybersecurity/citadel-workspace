import { ReactNode, useCallback, useState } from 'react';
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

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /**
   * May be async. The dialog stays open until it settles, so a caller can show
   * the failure reason inside this dialog instead of losing it to a closed one.
   */
  onConfirm: () => void | Promise<void>;
  description?: ReactNode;
  confirmLabel?: string;
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  onConfirm,
  description,
  confirmLabel = 'Delete',
}: ConfirmDeleteDialogProps): JSX.Element {
  const [pending, setPending] = useState(false);

  // AlertDialogAction IS a Radix Close: without preventDefault the dialog shuts
  // on the click, before an async onConfirm settles. Every caller here already
  // closes itself from its own state, and one of them renders its error message
  // into this dialog's description — unreachable while Radix closed it first.
  const handleConfirm: (event: React.MouseEvent) => void = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (pending) return;
      const result: void | Promise<void> = onConfirm();
      if (!(result instanceof Promise)) return;
      setPending(true);
      // `then` with both handlers, not `finally`. `finally` re-throws, so
      // `void result.finally(...)` cleared the pending flag and then discarded
      // a REJECTED promise -- an unhandled rejection from the dialog every
      // confirm action in the app shares, for any action that fails.
      //
      // Reporting belongs to the caller, which has the context to say what
      // failed; the dialog owns only its own pending state, and it clears that
      // either way.
      void result.then(
        () => setPending(false),
        () => setPending(false),
      );
    },
    [onConfirm, pending],
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-card border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="text-foreground/80">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={pending}
            className="bg-transparent border-border text-foreground hover:bg-card"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            // Named, because this is the second question and its label is
            // whatever the caller passed -- 'Delete permanently', 'Delete', a
            // future rewording. A spec that has to press it by copy breaks the
            // day the copy improves, which is what
            // `check-controls-are-addressed-by-testid` exists to prevent.
            data-testid="confirm-dialog-confirm"
            onClick={handleConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
