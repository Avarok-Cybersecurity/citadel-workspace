import { Check, CheckCheck, Clock, RefreshCw, XCircle } from 'lucide-react';
import type { PaneMessage } from '@/lib/chat/transport/chat-transport';
import { formatTime } from '@/components/chat/shared';
import { useContext, useId, useState } from 'react';
import { AwaitingAcceptContext, sendsWhenAcceptedCopy } from './awaiting-accept';
import { StatusPanel, StatusTick } from '@/components/shared/StatusDetails';
import { MessageStatusDetails, messageStatusLabel } from './MessageStatusDetails';

interface BubbleFooterProps {
  message: PaneMessage;
  isOwn: boolean;
  onRetry?: () => void;
}

// These ticks show only on the sender's own bubble (bg-primary), where muted measured
// 1.09:1 light and 2.53:1 dark; they take the bubble's foreground (UX review).
function getMessageStatusIcon(message: PaneMessage): JSX.Element | null {
  switch (message.status) {
    case 'pending':
      return <Clock className="h-3 w-3 text-primary-foreground" data-testid="message-status-pending" />;
    case 'sent':
      return <Check className="h-3 w-3 text-primary-foreground" data-testid="message-status-sent" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3 text-primary-foreground" data-testid="message-status-delivered" />;
    case 'read':
      return <CheckCheck className="h-3.5 w-3.5 text-read-receipt" strokeWidth={2.5} data-testid="message-status-read" aria-label="Seen" />;
    case 'failed':
      return <XCircle className="h-3 w-3 text-destructive" data-testid="message-status-failed" />;
    default:
      return null;
  }
}

export function BubbleFooter({ message, isOwn, onRetry }: BubbleFooterProps): JSX.Element {
  const isFailed: boolean = message.status === 'failed';
  const statusIcon: JSX.Element | null = getMessageStatusIcon(message);
  const [detailsOpen, setDetailsOpen] = useState<boolean>(false);
  const panelId: string = useId();
  const awaitingAcceptFrom: string | null = useContext(AwaitingAcceptContext);

  return (
    <>
      <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
        {/* Dimmed only off the sender's bubble: on bg-primary it measured 3.73:1 dimmed. */}
        <span className={`text-xs ${isOwn ? '' : 'opacity-70'}`} data-testid="message-timestamp">
          {formatTime(message.timestamp)}
        </span>
        {message.edited_at !== undefined && (
          // Both parties need to see that a message was revised, or an edit is
          // indistinguishable from having misread the original.
          <span
            className="text-xs opacity-90"
            data-testid="message-edited-marker"
            title={`Edited ${formatTime(message.edited_at)}`}
          >
            (edited)
          </span>
        )}
        {isOwn && statusIcon && (
          <StatusTick label={messageStatusLabel(message)} open={detailsOpen} onToggle={() => setDetailsOpen(!detailsOpen)} panelId={panelId}>
            {statusIcon}
          </StatusTick>
        )}
        {/* The one Retry for a failed message, whatever kind of bubble it is. The text bubbles used to
            carry a second, inline one beside "Failed to send". */}
        {isOwn && isFailed && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-1 inline-flex items-center gap-1 rounded text-xs underline hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
      {detailsOpen && statusIcon && (
        <StatusPanel id={panelId}>
          <MessageStatusDetails message={message} />
        </StatusPanel>
      )}
      {isOwn && message.status === 'pending' && awaitingAcceptFrom !== null && (
        <p className="text-xs mt-1" data-testid="message-held-note">{sendsWhenAcceptedCopy(awaitingAcceptFrom)}</p>
      )}
      {/* Error message for failed sends */}
      {isOwn && isFailed && message.error && (
        <p className="text-xs text-destructive-emphasis mt-1">{message.error}</p>
      )}
    </>
  );
}
