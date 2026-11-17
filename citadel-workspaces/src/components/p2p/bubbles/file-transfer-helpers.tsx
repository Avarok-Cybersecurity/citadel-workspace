import { File, FileImage, FileText, FileVideo, FileAudio, Download, X, Check, Clock, AlertCircle, Ban } from 'lucide-react';

export interface StatusContent {
  icon: React.ReactNode;
  text: string;
  showCancel?: boolean;
  showAcceptDecline?: boolean;
  showProgress?: boolean;
  clickable?: boolean;
}

/** Returns the appropriate Lucide file icon based on MIME type. */
export function getFileIcon(fileType: string): React.ReactNode {
  if (fileType.startsWith('image/')) return <FileImage className="h-5 w-5" />;
  if (fileType.startsWith('video/')) return <FileVideo className="h-5 w-5" />;
  if (fileType.startsWith('audio/')) return <FileAudio className="h-5 w-5" />;
  if (fileType.startsWith('text/') || fileType.includes('pdf')) return <FileText className="h-5 w-5" />;
  return <File className="h-5 w-5" />;
}

// Re-exported, not reimplemented. This copy used toFixed(1) while the transfer
// lifecycle's used toFixed(2), so a bubble and the progress line beside it
// showed the same file at two different sizes.
export { formatBytes } from '@/lib/format-bytes';

/**
 * An icon's colour on the sender's own bubble is the bubble's foreground: the state
 * colours (accent, warning) measured 1.09-2.69:1 on bg-primary (UX review).
 */
function iconTone(isOwn: boolean, stateColour: string): string {
  return isOwn ? 'text-primary-foreground' : stateColour;
}

/** Returns the status icon, text, and action flags for a given transfer state. */
export function getStatusContent(state: string, isOwn: boolean, reason: string | undefined, resuming: boolean): StatusContent {
  // Picked up again after a reload (lib/file-transfer/reload-recovery.ts): the
  // application is finishing it; nobody has anything to do but wait.
  if (resuming) {
    return {
      icon: <Clock className={`h-4 w-4 ${iconTone(isOwn, 'text-primary-accent')} animate-spin`} />,
      text: 'Resuming…',
      showProgress: state === 'transferring',
      showCancel: isOwn
    };
  }
  switch (state) {
    case 'pending':
      if (isOwn) {
        return {
          icon: <Clock className={`h-4 w-4 ${iconTone(isOwn, 'text-warning-emphasis')}`} />,
          text: 'Waiting for acceptance...',
          showCancel: true
        };
      }
      return {
        icon: <Download className={`h-4 w-4 ${iconTone(isOwn, 'text-primary-accent')}`} />,
        text: 'wants to send you a file',
        showAcceptDecline: true
      };

    case 'preparing':
      // Only the sender has this state: the file is going to their agent first.
      return {
        icon: <Clock className={`h-4 w-4 ${iconTone(isOwn, 'text-primary-accent')} animate-spin`} />,
        text: 'Preparing to send...',
        showProgress: true,
        showCancel: true
      };

    case 'queued':
      // Only the sender holds a send; the recipient has not been told of it yet.
      return {
        icon: <Clock className={`h-4 w-4 ${iconTone(isOwn, 'text-warning-emphasis')}`} />,
        text: reason ?? 'Will send when they are online',
        showCancel: true
      };

    case 'transferring':
      return {
        icon: <Download className={`h-4 w-4 ${iconTone(isOwn, 'text-primary-accent')} animate-pulse`} />,
        text: isOwn ? 'Sending...' : 'Downloading...',
        showProgress: true
      };

    case 'complete':
      if (isOwn) {
        return {
          icon: <Check className={`h-4 w-4 ${iconTone(isOwn, 'text-success-emphasis')}`} />,
          text: 'Sent successfully'
        };
      }
      return {
        icon: <Check className={`h-4 w-4 ${iconTone(isOwn, 'text-success-emphasis')}`} />,
        text: 'Downloaded',
        clickable: true
      };

    case 'declined':
      if (isOwn) {
        return {
          icon: <X className={`h-4 w-4 ${iconTone(isOwn, 'text-destructive')}`} />,
          text: 'Transfer declined'
        };
      }
      return {
        icon: <X className={`h-4 w-4 ${iconTone(isOwn, 'text-muted-foreground')}`} />,
        text: 'You declined this file'
      };

    case 'cancelled':
      if (isOwn) {
        return {
          icon: <Ban className={`h-4 w-4 ${iconTone(isOwn, 'text-muted-foreground')}`} />,
          text: 'Transfer cancelled'
        };
      }
      return {
        icon: <AlertCircle className={`h-4 w-4 ${iconTone(isOwn, 'text-warning-emphasis')}`} />,
        text: 'Sender cancelled transfer'
      };

    case 'expired':
      return {
        icon: <Clock className={`h-4 w-4 ${iconTone(isOwn, 'text-warning-emphasis')}`} />,
        text: reason || 'Request expired'
      };

    case 'error':
      return {
        icon: <AlertCircle className={`h-4 w-4 ${iconTone(isOwn, 'text-destructive')}`} />,
        text: reason ? `Transfer failed: ${reason}` : 'Transfer failed'
      };

    default:
      return {
        icon: <File className="h-4 w-4" />,
        text: 'Unknown state'
      };
  }
}
