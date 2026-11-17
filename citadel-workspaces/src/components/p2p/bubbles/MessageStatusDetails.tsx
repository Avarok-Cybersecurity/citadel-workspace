import type { PaneMessage } from '@/lib/chat/transport/chat-transport';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { interactive } from '@/lib/a11y';
import { formatPreciseDateTime } from '@/lib/format-time';
import { receiptSummary } from '@/lib/chat/transport/read-receipts';

interface MessageStatusDetailsProps {
  message: PaneMessage;
}

const statusLabels: Record<PaneMessage['status'], string> = {
  pending: 'Enqueued (waiting to send)',
  sent: 'Sent to server',
  delivered: 'Delivered to peer',
  read: 'Seen by peer',
  failed: 'Failed to send'
};

/** A channel's "read" is every member's, and its receipt says so; a direct chat's is the peer's. */
export function messageStatusLabel(message: PaneMessage): string {
  if (message.receipt !== undefined && message.status === 'read') return 'Seen by everyone';
  return statusLabels[message.status];
}

const statusColors: Record<PaneMessage['status'], string> = {
  pending: 'text-muted-foreground',
  sent: 'text-foreground/80',
  delivered: 'text-success-emphasis',
  read: 'text-primary-accent',
  failed: 'text-destructive'
};


function truncateCid(cid: string): string {
  if (!cid) return 'N/A';
  if (cid.length <= 16) return cid;
  return `${cid.slice(0, 10)}...${cid.slice(-4)}`;
}

function truncateId(id: string): string {
  if (!id) return 'N/A';
  if (id.length <= 8) return id;
  return id.slice(0, 8);
}

interface RowProps {
  label: string;
  value: string;
  valueClassName?: string;
  copyable?: boolean;
  fullValue?: string;
}

function Row({ label, value, valueClassName = 'text-foreground', copyable, fullValue }: RowProps): JSX.Element {
  const { copied, copy } = useCopyToClipboard();
  // The result is not needed here: a refusal is toasted by useCopyToClipboard,
  // and success shows as the control's `copied` tick.
  const handleCopy = (): void => { void copy(fullValue || value); };

  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}:</span>
      <span
        className={`font-mono ${valueClassName} ${copyable ? 'cursor-pointer hover:underline' : ''}`}
        // Only interactive when it is actually copyable: giving a non-copyable
        // value role="button" and a tab stop would put it in the tab order and
        // announce it as actionable when nothing happens on activation.
        {...(copyable ? interactive(handleCopy) : {})}
        title={copyable ? `Click to copy: ${fullValue || value}` : undefined}
      >
        {copied ? 'Copied' : value}
      </span>
    </div>
  );
}

export function MessageStatusDetails({ message }: MessageStatusDetailsProps): JSX.Element {
  return (
    <div className="space-y-1 text-xs min-w-[200px]">
      <div className="font-semibold text-foreground border-b border-border pb-1 mb-2">
        Message Details
      </div>
      <Row
        label="Status"
        value={messageStatusLabel(message)}
        valueClassName={statusColors[message.status]}
      />
      <Row
        label="Sent"
        value={formatPreciseDateTime(message.timestamp)}
      />
      <Row
        label="ID"
        value={truncateId(message.id)}
        fullValue={message.id}
        copyable
      />
      {/* A direct chat's two ends; a channel message has a sender's name and no recipient. */}
      {message.senderCid !== undefined && (
        <Row label="From" value={truncateCid(message.senderCid.toString())} fullValue={message.senderCid.toString()} copyable />
      )}
      {message.recipientCid !== undefined && (
        <Row label="To" value={truncateCid(message.recipientCid.toString())} fullValue={message.recipientCid.toString()} copyable />
      )}
      {message.receipt !== undefined && (
        <>
          <p className="pt-1 text-muted-foreground" data-testid="message-receipt-summary">{receiptSummary(message.receipt)}</p>
          {message.receipt.seenBy.length > 0 && (
            <ul className="text-foreground" aria-label="Seen by" data-testid="message-seen-by">
              {message.receipt.seenBy.map((name: string, i: number): JSX.Element => <li key={`${i}:${name}`} className="truncate">{name}</li>)}
            </ul>
          )}
        </>
      )}
      {message.error && (
        <Row
          label="Error"
          value={message.error}
          valueClassName="text-destructive"
        />
      )}
    </div>
  );
}
