/**
 * The status strip under the list: how many peers have a live connection, which
 * storage this is, and how full it is.
 *
 * The quota means different things on each side, and is named for what it is:
 * on the server it is your space; in peer storage it is the room YOU give that
 * peer on your agent (fileTransferService.getSettings(peer).revfsQuota), and the
 * bytes counted against it are the files you host for them.
 */
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/format-bytes';

interface FileManagerStatusStripProps {
  connectedPeers: number;
  storageName: string;
  usedBytes: number;
  quotaBytes: number;
  /** Peer storage names who the hosted space is for. */
  hostingFor: string | null;
}

export function FileManagerStatusStrip({ connectedPeers, storageName, usedBytes, quotaBytes, hostingFor }: FileManagerStatusStripProps): JSX.Element {
  const percent: number = quotaBytes > 0 ? Math.min((usedBytes / quotaBytes) * 100, 100) : 0;
  const amount: string = `${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)}`;
  const quotaLabel: string = hostingFor === null ? `${amount} used` : `Hosting ${amount} for ${hostingFor}`;
  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] border-t border-border bg-card px-[16px] py-[6px] text-xs text-muted-foreground" data-testid="vfs-status-strip">
      <span className="flex items-center gap-[6px]">
        <span className={cn('h-[7px] w-[7px] rounded-full', connectedPeers > 0 ? 'bg-success' : 'bg-muted-foreground')} aria-hidden="true" />
        {connectedPeers} {connectedPeers === 1 ? 'peer' : 'peers'} connected
      </span>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate">{storageName}</span>
      <span className="ml-auto flex items-center gap-[8px]">
        <span
          className="h-[5px] w-[96px] overflow-hidden rounded-full bg-surface" role="meter"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-label={quotaLabel}
        >
          <span className={cn('block h-full rounded-full', percent >= 95 ? 'bg-destructive' : percent >= 80 ? 'bg-warning' : 'bg-primary')} style={{ width: `${percent}%` }} />
        </span>
        <span className="whitespace-nowrap">{quotaLabel}</span>
      </span>
    </div>
  );
}
