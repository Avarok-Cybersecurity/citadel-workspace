import { useState } from "react";
import { useConfirm } from '@/components/shared/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { MemberAvatar } from "@/components/shared/MemberAvatar";
import type { ActiveSession } from "@/types/session-types";

export type DisconnectAction = "disconnect" | "deregister";

interface DisconnectConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ActiveSession | null;
  workspaceName: string | null;
  onConfirm: (action: DisconnectAction) => void;
}

export const DisconnectConfirmModal = ({
  open,
  onOpenChange,
  session,
  workspaceName,
  onConfirm,
}: DisconnectConfirmModalProps): JSX.Element | null => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedAction, setSelectedAction] = useState<DisconnectAction | null>(null);
  const confirm: ReturnType<typeof useConfirm> = useConfirm();

  if (!session) return null;

  const handleConfirm = async (action: DisconnectAction): Promise<void> => {
    // Deleting an account is irreversible and the keys cannot be regenerated,
    // so it is asked twice — the two buttons sit side by side, and this one
    // used to fire on the first click with only a paragraph between it and a
    // user tidying up their sessions list.
    if (
      action === 'deregister' &&
      !(await confirm({
        title: `Delete ${session.username} permanently?`,
        description:
          'This removes the account from the server for good. It cannot be undone, ' +
          'and the keys for it cannot be regenerated. Signing out instead keeps ' +
          'everything and lets you come back.',
        confirmLabel: 'Delete permanently',
      }))
    ) {
      return;
    }
    // Either way the account's documents leave this device, edits not yet sent included; this
    // tab is not signed in as it, so they can only be kept by not signing out.
    if (session.cid !== undefined && !(await (await import('@/lib/document-save/held-edits-io')).mayLeaveAccountHeldEdits(session.cid, false, confirm))) {
      return;
    }

    setIsProcessing(true);
    setSelectedAction(action);
    try {
      await onConfirm(action);
    } finally {
      setIsProcessing(false);
      setSelectedAction(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground">
            Sign out, or delete this account?
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-2">
            Two different things can happen to{" "}
            <span className="font-semibold text-primary-accent">
              {workspaceName || session.username}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 p-4 bg-input rounded-lg border border-border">
          <div className="flex items-center gap-3">
            <MemberAvatar username={session.username} name={session.full_name || session.username} className="h-10 w-10 text-sm" />
            <div>
              <div className="font-medium text-foreground">
                {session.full_name || session.username}
              </div>
              <div className="text-sm text-muted-foreground">@{session.username}</div>
            </div>
          </div>
        </div>

        {/* The stakes, in the user's terms.
            This read "Deregister permanently removes this account from the
            server. Use this for cleanup between test runs." — developer copy on
            the destructive branch of a modal a first-time user reaches while
            tidying up the sessions strip, offering "Disconnect" and
            "Deregister" as if the difference were obvious. */}
        <div className="p-3 bg-destructive/10 border border-destructive/25 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div className="text-sm text-destructive-emphasis">
            <strong>Signing out</strong> ends the session on this device. Your account,
            your messages and your files stay where they are, and you can sign back in.
            <br />
            <strong>Deleting the account</strong> removes it from the server for good.
            It cannot be undone, and the keys for it cannot be regenerated.
          </div>
        </div>

        <DialogFooter className="flex flex-col gap-2 mt-4">
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <Button
              onClick={() => handleConfirm("disconnect")}
              data-testid="confirm-sign-out"
              variant="outline"
              className="flex-1 bg-transparent border-warning text-warning-emphasis hover:bg-warning/15 hover:text-warning-emphasis/15"
              disabled={isProcessing}
            >
              {isProcessing && selectedAction === "disconnect" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing out...
                </>
              ) : (
                "Sign out"
              )}
            </Button>
            <Button
              onClick={() => handleConfirm("deregister")}
              data-testid="confirm-delete-account"
              className="flex-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              disabled={isProcessing}
            >
              {isProcessing && selectedAction === "deregister" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete account permanently"
              )}
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="w-full text-muted-foreground hover:bg-accent hover:text-foreground"
            disabled={isProcessing}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
