import { X, Check } from 'lucide-react';
import { getBubbleStyles, BUBBLE_MAX_WIDTH , type FileTransferBubbleProps } from './types';
import { BubbleFooter } from './BubbleFooter';
import { debugLog } from '@/lib/debug-config';
import { getFileIcon, formatBytes, getStatusContent } from './file-transfer-helpers';
import type { StatusContent } from '@/components/p2p/bubbles/file-transfer-helpers';
import { useTransferView } from '../hooks/useTransferView';
import { TransferProgressBar } from './TransferProgressBar';
import type { TransferView } from '@/lib/file-transfer/transfer-view';
import { safeThumbnail } from '@/lib/received-files/image-preview';
import { TransferPicture } from './TransferPicture';
import { ResendLostFile } from './ResendLostFile';

/**
 * FileTransferBubble - Displays file transfer messages with state-dependent UI
 *
 * States (sender view):
 * - queued: "Will send when {name} is online" + Cancel button
 * - pending: "Waiting for acceptance..." + Cancel button
 * - transferring: Progress bar with percentage
 * - complete: "Sent successfully"
 * - declined: "Transfer declined"
 * - cancelled: "Transfer cancelled"
 * - expired: "Request expired"
 * - error: Error message
 *
 * States (receiver view):
 * - pending: Accept/Decline buttons
 * - transferring: "Downloading..." + progress bar
 * - complete: "Downloaded" (clickable: the browser downloads the original)
 * - declined: "You declined this file"
 * - cancelled: "Sender cancelled transfer"
 */
export function FileTransferBubble({
  message,
  isOwn,
  onRetry,
  onAccept,
  onDecline,
  onCancel,
  onOpen
}: FileTransferBubbleProps): JSX.Element {
  const view: TransferView = useTransferView(message, isOwn ? 'sent' : 'received');
  const state: string = view.state;
  const isFailed: boolean = message.status === 'failed' || state === 'error';
  const bubbleStyles: string = getBubbleStyles(isOwn, isFailed);

  // DEBUG: Log to understand why Accept/Decline may not show
  debugLog('FileTransferBubble', '[FileTransferBubble] Debug:', {
    isOwn,
    state,
    senderCid: message.senderCid,
    recipientCid: message.recipientCid,
    transfer_id: message.transfer_id,
    fileName: message.file_name
  });
  const progress: number = view.progress;
  const fileName: string = message.file_name || 'Unknown file';
  const fileSize: number = message.file_size || 0;
  const fileType: string = message.file_type || 'application/octet-stream';

  const status: StatusContent = getStatusContent(state, isOwn, view.reason, view.resuming);
  // The offer's thumbnail is the sender's string: drawn only when it is an inline raster picture.
  const thumbnail: string | null = safeThumbnail(message.file_thumbnail);

  const handleClick = (): void => {
    // By transfer, not by path: a direct P2P transfer has no virtual_path, so the
    // click required one and did nothing while the hint said it would open.
    if (status.clickable && onOpen && message.transfer_id) {
      onOpen(message.transfer_id);
    }
  };

  const handleAccept = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (onAccept && message.transfer_id) {
      onAccept(message.transfer_id);
    }
  };

  const handleDecline = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (onDecline && message.transfer_id) {
      onDecline(message.transfer_id);
    }
  };

  const handleCancel = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (onCancel && message.transfer_id) {
      onCancel(message.transfer_id);
    }
  };

  const header: JSX.Element = (
        <div className="flex items-start gap-3 mb-2">
          {/* File icon with thumbnail support */}
          <div className="p-2 rounded bg-foreground/10 flex-shrink-0">
            {thumbnail !== null ? (
              <img
                src={thumbnail}
                alt={fileName}
                className="h-10 w-10 object-cover rounded"
              />
            ) : (
              getFileIcon(fileType)
            )}
          </div>

          {/* File details */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{fileName}</p>
            <div className="flex items-center gap-2 text-xs">
              <span>{formatBytes(fileSize)}</span>
            </div>
          </div>
        </div>
  );

  return (
    <div
      data-testid="file-transfer-bubble"
      data-transfer-state={state}
      data-is-own={String(isOwn)}
      className={`${BUBBLE_MAX_WIDTH} rounded-lg px-3 py-2 ${bubbleStyles}`}
    >
      <div>
        <TransferPicture message={message} isOwn={isOwn} />
        {/* File info header. A button only when a finished download can be opened: the bubble
            used to be a role="button" in every state, around the Accept/Decline/Cancel buttons
            (a button inside a button, and a focus stop that did nothing). */}
        {status.clickable ? (
          <button type="button" onClick={handleClick} data-testid="file-transfer-open" className="w-full text-left cursor-pointer hover:opacity-90 transition-opacity">
            {header}
          </button>
        ) : header}

        {/* Status section */}
        <div className="flex items-center gap-2 mb-2">
          {status.icon}
          <span className="text-xs">{status.text}</span>
        </div>

        {/* Progress bar */}
        {status.showProgress && (
          <TransferProgressBar percent={progress} doneBytes={fileSize * progress / 100} totalBytes={fileSize} label={`Transfer of ${fileName}`} onPrimary={isOwn} />
        )}

        {/* Action buttons */}
        {status.showAcceptDecline && (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={handleAccept}
              data-testid="file-transfer-accept"
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-success/20 hover:bg-success/30 text-success-emphasis rounded text-sm transition-colors"
            >
              <Check className="h-4 w-4" />
              Accept
            </button>
            <button
              type="button"
              onClick={handleDecline}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-destructive/20 hover:bg-destructive/30 text-destructive-emphasis rounded text-sm transition-colors"
            >
              <X className="h-4 w-4" />
              Decline
            </button>
          </div>
        )}

        {status.showCancel && (
          <div className="mt-2">
            <button
              type="button"
              onClick={handleCancel}
              className={`w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded text-sm transition-colors border ${
                // On the sender's own bubble (bg-primary) the label takes the bubble's own
                // foreground; muted-on-primary measured 1.94:1 (UX review, finding 5).
                isOwn ? 'border-primary-foreground/40 text-primary-foreground hover:bg-primary-foreground/10' : 'border-border text-foreground hover:bg-foreground/5'
              }`}
            >
              <X className="h-4 w-4" />
              Cancel send
            </button>
          </div>
        )}

        {isOwn && view.resendable && message.transfer_id && <ResendLostFile transferId={message.transfer_id} />}

        {/* Click hint for completed downloads */}
        {status.clickable && (
          <p className="text-xs mt-1">Click to download</p>
        )}
      </div>

      <BubbleFooter message={message} isOwn={isOwn} onRetry={onRetry} />
    </div>
  );
}
