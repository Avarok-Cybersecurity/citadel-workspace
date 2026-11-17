import { AlertCircle, HardDrive } from 'lucide-react';
import { formatBytes } from '@/lib/format-bytes';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StorageLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  usedBytes: number;
  quotaBytes: number;
  attemptedFileSize: number;
  /** Called when user clicks "Manage Storage" */
  onManageStorage?: () => void;
}

/**
 * Format bytes to human-readable string (e.g., "45.2 MB")
 */


/**
 * Modal displayed when a file upload would exceed storage quota.
 * Shows current usage, available space, and options to manage storage.
 */
export function StorageLimitModal({
  isOpen,
  onClose,
  usedBytes,
  quotaBytes,
  attemptedFileSize,
  onManageStorage,
}: StorageLimitModalProps): JSX.Element {
  const availableBytes: number = Math.max(0, quotaBytes - usedBytes);
  const percentage: number = quotaBytes > 0 ? Math.min((usedBytes / quotaBytes) * 100, 100) : 0;

  // Determine bar color based on usage
  const barColor: "bg-warning" | "bg-destructive" | "bg-primary" = percentage >= 95
    ? 'bg-destructive'
    : percentage >= 80
      ? 'bg-warning'
      : 'bg-primary';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface border-border text-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Storage Limit Reached
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Not enough space to upload this file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Storage usage display */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <HardDrive className="h-4 w-4" />
                Current Usage
              </span>
              <span className="text-foreground/80">
                {formatBytes(usedBytes)} / {formatBytes(quotaBytes)}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 bg-card rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-300', barColor)}
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>

          {/* File size info */}
          <div className="bg-card rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">File size:</span>
              <span className="text-foreground font-medium">{formatBytes(attemptedFileSize)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Available space:</span>
              <span className="text-destructive-emphasis font-medium">{formatBytes(availableBytes)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Space needed:</span>
              <span className="text-warning-emphasis font-medium">
                {formatBytes(Math.max(0, attemptedFileSize - availableBytes))} more
              </span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Delete some files to free up space, or contact the server administrator to increase your quota.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="bg-card border-primary-accent text-foreground hover:bg-border hover:text-foreground"
          >
            Cancel
          </Button>
          {onManageStorage && (
            <Button
              onClick={() => {
                onManageStorage();
                onClose();
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Manage Storage
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
