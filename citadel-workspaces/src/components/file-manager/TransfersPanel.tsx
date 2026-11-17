/**
 * The transfer queue: P2P sends and receives in flight, the last few that
 * finished, and changes to shared storage the peer has not confirmed.
 *
 * Docked under the list rather than floating over it: a card over the rows hid
 * the rows it was reporting on, and the list is what a person checks a transfer
 * against.
 */
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { baseName } from '@/lib/revfs/tree-queries';
import { cn } from '@/lib/utils';
import { FileBadgeChip } from './ItemGlyphs';
import type { TransferRow } from './transfer-rows';

interface TransfersPanelProps {
  rows: readonly TransferRow[];
  active: number;
  /** Shared-storage changes awaiting the peer, which report no progress of their own. */
  pendingPaths: ReadonlySet<string>;
  peerLabel: string;
  onClose: () => void;
}

function Bar({ percent, status }: { percent: number | null; status: TransferRow['status'] }): JSX.Element {
  return (
    <div className="h-[4px] w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
      <div
        className={cn('h-full rounded-full', status === 'done' ? 'bg-success' : status === 'failed' ? 'bg-destructive' : 'bg-primary')}
        style={{ width: `${percent ?? 0}%` }}
      />
    </div>
  );
}

export function TransfersPanel({ rows, active, pendingPaths, peerLabel, onClose }: TransfersPanelProps): JSX.Element {
  const done: number = rows.filter((r: TransferRow): boolean => r.status === 'done').length;
  const pending: string[] = [...pendingPaths];
  const nothing: boolean = rows.length === 0 && pending.length === 0;
  return (
    <section id="vfs-transfers" aria-label="Transfers" className="flex max-h-[40%] min-h-0 shrink-0 flex-col border-t border-border bg-card" data-testid="vfs-transfers">
      <header className="flex items-center gap-[8px] border-b border-border px-[16px] py-[6px]">
        <h2 className="text-sm font-semibold text-foreground">Transfers</h2>
        <span className="text-xs text-muted-foreground">{active} active · {done} done</span>
        <Button variant="ghost" size="icon" className="ml-auto h-[28px] w-[28px]" onClick={onClose} aria-label="Close transfers">
          <X className="h-[14px] w-[14px]" aria-hidden="true" />
        </Button>
      </header>
      {/* Focusable because it scrolls: a long queue must be reachable without a pointer. */}
      <div role="region" aria-label="Transfer queue" tabIndex={0} className="min-h-0 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ul>
          {nothing && <li className="px-[16px] py-[12px] text-sm text-muted-foreground">Nothing is being sent or received.</li>}
          {rows.map((row: TransferRow) => (
            <li key={row.id} className="flex flex-col gap-[6px] border-b border-border px-[16px] py-[10px] last:border-b-0" data-testid="vfs-transfer-row">
              <div className="flex min-w-0 items-center gap-[10px]">
                <FileBadgeChip name={row.name} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{row.name}</span>
                <span className={cn('shrink-0 text-xs tabular-nums', row.status === 'done' ? 'text-success-emphasis' : row.status === 'failed' ? 'text-destructive-emphasis' : 'text-muted-foreground')}>
                  {row.figure}
                </span>
              </div>
              <Bar percent={row.percent} status={row.status} />
              <span className="truncate text-xs text-muted-foreground">{row.line}</span>
            </li>
          ))}
          {pending.map((path: string) => (
            <li key={path} className="flex min-w-0 items-center gap-[10px] border-b border-border px-[16px] py-[10px] last:border-b-0">
              <FileBadgeChip name={baseName(path)} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{baseName(path)}</span>
              <span className="shrink-0 text-xs text-warning-emphasis">Waiting for {peerLabel} to confirm</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
