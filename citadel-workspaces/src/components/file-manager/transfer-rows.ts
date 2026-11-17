/**
 * What the transfers panel shows for each transfer, as a pure function of the
 * service's record and the rate derived from its progress (transfer-rate.ts).
 */
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { FileTransferState } from '@/types/messaging-layer';
import { bytesMoved, etaSeconds } from '@/lib/file-transfer/transfer-rate';
import { formatBytes } from '@/lib/format-bytes';

export type TransferRowStatus = 'active' | 'done' | 'failed';

export interface TransferRow {
  id: string;
  name: string;
  status: TransferRowStatus;
  /** Null where no progress is known yet (not accepted, still being staged). */
  percent: number | null;
  /** "68% · 2.1 MB/s", "Done". */
  figure: string;
  /** "Receiving from Bob · 12 s left", "Received 14:02 · verified". */
  line: string;
}

const LIVE: ReadonlySet<FileTransferState> = new Set<FileTransferState>(['queued', 'preparing', 'pending', 'transferring']);
const RECENT_DONE: number = 5;

export function isLive(t: FileTransfer): boolean {
  return LIVE.has(t.state);
}

export function activeCount(all: readonly FileTransfer[]): number {
  return all.filter(isLive).length;
}

export function transfersShown(all: readonly FileTransfer[]): FileTransfer[] {
  const live: FileTransfer[] = all.filter(isLive).sort((a, b) => a.createdAt - b.createdAt);
  const done: FileTransfer[] = all.filter((t) => !isLive(t)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_DONE);
  return [...live, ...done];
}

function rateLabel(bytesPerSecond: number | null): string | null {
  return bytesPerSecond === null || bytesPerSecond <= 0 ? null : `${formatBytes(bytesPerSecond)}/s`;
}

function etaLabel(seconds: number | null): string | null {
  if (seconds === null) return null;
  return seconds < 60 ? `${seconds} s left` : `${Math.ceil(seconds / 60)} min left`;
}

const STOPPED: Readonly<Partial<Record<FileTransferState, string>>> = {
  declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired before it was accepted',
};

export function transferRow(
  t: FileTransfer, bytesPerSecond: number | null, nameOf: (cid: string) => string, locale: string | undefined,
): TransferRow {
  const other: string = nameOf(t.isIncoming ? t.senderCid : t.recipientCid);
  const base: Pick<TransferRow, 'id' | 'name'> = { id: t.id, name: t.fileName };
  if (t.state === 'complete') {
    const at: string = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t.updatedAt);
    return { ...base, status: 'done', percent: 100, figure: 'Done', line: `${t.isIncoming ? 'Received' : 'Sent'} ${at} · verified` };
  }
  if (t.state === 'error') return { ...base, status: 'failed', percent: null, figure: 'Failed', line: `Failed: ${t.errorMessage ?? 'no reason was given'}` };
  const stopped: string | undefined = STOPPED[t.state];
  if (stopped !== undefined) return { ...base, status: 'failed', percent: null, figure: stopped, line: stopped };

  if (t.state !== 'transferring') {
    const waiting: string = t.state === 'queued' ? `Sends when ${t.waitingFor ?? other} is online`
      : t.state === 'preparing' ? 'Preparing' : t.isIncoming ? `Waiting for you to accept` : `Waiting for ${other} to accept`;
    return { ...base, status: 'active', percent: null, figure: '—', line: waiting };
  }
  const rate: string | null = rateLabel(bytesPerSecond);
  const eta: string | null = etaLabel(etaSeconds(t.fileSize, bytesMoved(t.progress, t.fileSize), bytesPerSecond));
  const who: string = `${t.isIncoming ? 'Receiving from' : 'Sending to'} ${other}`;
  return {
    ...base, status: 'active', percent: t.progress,
    figure: rate ? `${t.progress}% · ${rate}` : `${t.progress}%`,
    line: eta ? `${who} · ${eta}` : who,
  };
}
