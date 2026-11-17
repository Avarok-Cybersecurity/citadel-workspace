/**
 * A file shared into a peer group, as its bubble shows it.
 *
 * The sender's copy carries the per-member ledger and renders who has it; a
 * member's copy says where the offer to accept is -- it arrives as an ordinary
 * P2P offer from the sender, not in the group, because the agent can only send
 * a file to one peer at a time.
 */
import React from 'react';
import type { GroupFileShare, MemberDelivery } from '@/types/group-file-share';
import { formatBytes } from '@/lib/format-bytes';
import { getFileIcon } from '@/components/p2p/bubbles/file-transfer-helpers';
import type { DeliverySummary, MemberDeliveryRow, MemberDeliveryStatus } from '@/lib/group-conversations/group-file-delivery-state';
import { useGroupFileDeliveries } from './useGroupFileDeliveries';

const STATUS_LABEL: Record<MemberDeliveryStatus, string> = {
  sent: 'sent, awaiting an answer',
  accepted: 'accepted',
  received: 'received',
  declined: 'declined',
  failed: 'failed',
  'not-delivered': 'not delivered',
};

function rowText(row: MemberDeliveryRow): string {
  const label: string = STATUS_LABEL[row.status];
  return row.reason ? `${label} — ${row.reason}` : label;
}

function DeliveryList({ deliveries }: { deliveries: readonly MemberDelivery[] }): JSX.Element {
  const summary: DeliverySummary = useGroupFileDeliveries(deliveries);
  return (
    <div className="mt-2 border-t border-surface/50 pt-2" data-testid="group-file-deliveries">
      <p className="text-xs font-medium" data-testid="group-file-summary">{summary.text}</p>
      <ul className="mt-1 space-y-0.5">
        {summary.rows.map((row: MemberDeliveryRow) => (
          <li key={row.cid.toString()} className="text-xs" data-testid="group-file-delivery" data-status={row.status}>
            <span className="font-medium">{row.username}</span>: {rowText(row)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GroupFileShareCard({ share, senderName }: { share: GroupFileShare; senderName: string }): JSX.Element {
  return (
    <div data-testid="group-file-share">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="shrink-0">{getFileIcon(share.mimeType)}</span>
        <div className="min-w-0">
          <p className="font-medium break-all">{share.name}</p>
          <p className="text-xs opacity-80">{formatBytes(share.size)} · shared by {senderName}</p>
        </div>
      </div>
      {share.deliveries ? (
        <DeliveryList deliveries={share.deliveries} />
      ) : (
        <p className="mt-2 text-xs opacity-80">
          Sent to each member directly. Accept or decline it in your chat with {senderName}.
        </p>
      )}
    </div>
  );
}
