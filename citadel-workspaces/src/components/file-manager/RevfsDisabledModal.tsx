import { AlertTriangle, Settings, Server, UserCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type DisabledReason = 'peer_disabled' | 'server_disabled';

interface RevfsDisabledModalProps {
  isOpen: boolean;
  onClose: () => void;
  reason: DisabledReason;
  /** The refused offer's own words (lib/revfs/storage-offer.ts): the server's reason, when it gave one. */
  explanation: string;
  /** Called when user clicks "Open Settings" (only for P2P) */
  onOpenSettings?: () => void;
}

/**
 * Modal displayed when RE-VFS storage is disabled.
 * Shows explanation based on whether it's peer or server storage.
 */
export function RevfsDisabledModal({
  isOpen,
  onClose,
  reason,
  explanation,
  onOpenSettings,
}: RevfsDisabledModalProps): JSX.Element {
  const isPeerDisabled: boolean = reason === 'peer_disabled';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <AlertTriangle className="h-5 w-5 text-warning-emphasis" />
            Remote Storage Unavailable
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {explanation}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Icon display */}
          <div className="flex justify-center py-4">
            <div className="rounded-full bg-card p-6">
              {isPeerDisabled ? (
                <UserCircle2 className="h-12 w-12 text-warning-emphasis" />
              ) : (
                <Server className="h-12 w-12 text-warning-emphasis" />
              )}
            </div>
          </div>

          {/* Explanation */}
          <div className="bg-card rounded-lg p-4 space-y-3">
            {isPeerDisabled ? (
              <>
                <p className="text-sm text-foreground/80">
                  Your peer hasn't enabled remote storage on their device. To use the shared file system:
                </p>
                <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                  <li>Ask your peer to enable remote storage in their Chat Settings</li>
                  <li>Both users must have remote storage enabled</li>
                  <li>You can still use standard file transfers</li>
                </ul>
              </>
            ) : (
              <>
                <p className="text-sm text-foreground/80">
                  The server administrator has disabled RE-VFS storage:
                </p>
                <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                  <li>Server-side encrypted storage is not available</li>
                  <li>Contact the administrator to request access</li>
                  <li>You can still use P2P storage with peers</li>
                </ul>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            onClick={onClose}
            className="bg-card border-primary-accent text-foreground hover:bg-border hover:text-foreground"
          >
            {isPeerDisabled ? 'OK' : 'Close'}
          </Button>
          {isPeerDisabled && onOpenSettings && (
            <Button
              onClick={() => {
                onOpenSettings();
                onClose();
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Settings className="h-4 w-4 mr-2" />
              Open Settings
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
