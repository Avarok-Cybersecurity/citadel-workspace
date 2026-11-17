/**
 * Choosing whose shared storage to open. It writes `peer_id` to the address, so
 * the choice can be linked to and Back undoes it, and it never chooses for you:
 * with no peer chosen the P2P side asks, rather than opening whoever sorted first.
 */
import type { ReactNode } from 'react';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { StoragePeer } from './storage-peers';

function presence(peer: StoragePeer): { dot: string; label: string } {
  if (peer.isConnected === true) return { dot: 'bg-success', label: 'Connected' };
  if (peer.isOnline === true) return { dot: 'bg-warning', label: 'Online' };
  return { dot: 'bg-muted-foreground', label: peer.isOnline === false ? 'Offline' : 'Status unknown' };
}

export function StoragePeerMenuItems({ peers, loading, selected, onChoose }: {
  peers: readonly StoragePeer[]; loading: boolean; selected: bigint | null; onChoose: (cid: bigint) => void;
}): JSX.Element {
  let body: ReactNode;
  if (peers.length === 0) {
    body = (
      <DropdownMenuItem disabled className="max-w-[260px] whitespace-normal text-sm">
        {loading ? 'Finding your peers…' : 'No peers yet. Storage is shared with a member once you and they are registered peers.'}
      </DropdownMenuItem>
    );
  } else {
    body = peers.map((peer: StoragePeer) => {
      const shown: { dot: string; label: string } = presence(peer);
      return (
        <DropdownMenuItem
          key={peer.cid.toString()}
          onSelect={() => onChoose(peer.cid)}
          className={cn('min-h-[32px] cursor-pointer gap-[10px]', selected === peer.cid && 'bg-surface')}
          data-testid={`storage-peer-${peer.username}`}
        >
          <span className={cn('h-[8px] w-[8px] shrink-0 rounded-full', shown.dot)} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{peer.displayName}</span>
          <span className="text-xs text-muted-foreground">{shown.label}</span>
        </DropdownMenuItem>
      );
    });
  }
  return (
    <>
      <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shared with</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {body}
    </>
  );
}
