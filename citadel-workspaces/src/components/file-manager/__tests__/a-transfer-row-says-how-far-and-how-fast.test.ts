/**
 * A row in the transfers panel: name, percent and rate, who it is with and how
 * long is left; done rows read "verified"; a failure says what happened. And
 * which transfers are listed: everything in flight, then the latest few that
 * finished.
 */
import { describe, it, expect } from 'vitest';
import type { FileTransfer } from '@/lib/file-transfer/types';
import { transferRow, transfersShown, activeCount, type TransferRow } from '../transfer-rows';

const MB: number = 1024 * 1024;
const NOW: number = new Date(2026, 9, 16, 14, 30).getTime();
const nameOf = (cid: string): string => (cid === '20' ? 'Donovan' : 'Thomas');

function transfer(over: Partial<FileTransfer>): FileTransfer {
  return {
    id: 't1', fileName: 'plan.dwg', fileSize: 10 * MB, fileType: '', state: 'transferring', progress: 68,
    senderCid: '20', recipientCid: '10', createdAt: NOW - 60_000, updatedAt: NOW, isIncoming: true, ...over,
  };
}

describe('a transfer row', () => {
  it('shows percent and rate, and who it comes from with the time left', () => {
    const row: TransferRow = transferRow(transfer({}), 2 * MB, nameOf, 'en-US');
    expect(row.status).toBe('active');
    expect(row.percent).toBe(68);
    expect(row.figure).toBe('68% · 2 MB/s');
    expect(row.line).toBe('Receiving from Donovan · 2 s left');
  });

  it('says it is sending, and to whom', () => {
    const row: TransferRow = transferRow(transfer({ isIncoming: false, progress: 23 }), null, nameOf, 'en-US');
    expect(row.figure).toBe('23%');
    expect(row.line).toBe('Sending to Thomas');
  });

  it('turns done and verified when complete', () => {
    const row: TransferRow = transferRow(transfer({ state: 'complete', progress: 100, updatedAt: new Date(2026, 9, 16, 14, 2).getTime() }), null, nameOf, 'en-US');
    expect(row.status).toBe('done');
    expect(row.figure).toBe('Done');
    expect(row.line).toBe('Received 14:02 · verified');
  });

  it('says what stopped a transfer that did not finish', () => {
    expect(transferRow(transfer({ state: 'declined' }), null, nameOf, 'en-US').line).toBe('Declined');
    const failed: TransferRow = transferRow(transfer({ state: 'error', errorMessage: 'Peer went away' }), null, nameOf, 'en-US');
    expect(failed.status).toBe('failed');
    expect(failed.line).toBe('Failed: Peer went away');
  });

  it('waits visibly when the peer has not accepted yet', () => {
    const row: TransferRow = transferRow(transfer({ state: 'pending', progress: 0, isIncoming: false }), null, nameOf, 'en-US');
    expect(row.percent).toBeNull();
    expect(row.line).toBe('Waiting for Thomas to accept');
  });
});

describe('which transfers are listed', () => {
  it('lists everything in flight, then the five that finished most recently', () => {
    const live: FileTransfer[] = [transfer({ id: 'a' }), transfer({ id: 'b', state: 'pending' })];
    const finished: FileTransfer[] = Array.from({ length: 7 }, (_: unknown, i: number) => transfer({ id: `d${i}`, state: 'complete', updatedAt: NOW - i }));
    const shown: FileTransfer[] = transfersShown([...finished, ...live]);
    expect(shown.map((t) => t.id)).toEqual(['a', 'b', 'd0', 'd1', 'd2', 'd3', 'd4']);
    expect(activeCount([...finished, ...live])).toBe(2);
  });
});
