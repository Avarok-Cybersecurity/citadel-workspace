/**
 * The SDK ends a transfer that stopped being answered with `Failed { code, message }` (code 666,
 * FileTransferStalled) rather than the text-only `Fail`. The tick parser recognised only `Fail`,
 * so a coded failure was dropped: the chat transfer it ended stayed "transferring" for ever, at
 * the sender and at the receiver alike.
 */
import { describe, expect, it } from 'vitest';
import { parseTickNotification, type TickCorrelation } from '../tick-events';
import type { FileTransferTickNotification } from '../protocol-types';
import {
  FILE_TRANSFER_STALLED_CODE, STALLED_TRANSFER_COPY, transferFailureReason, UNEXPLAINED_TRANSFER_FAILURE,
} from '../transfer-failure';

const correlation = (): TickCorrelation => ({
  objectIdToTransferId: new Map<string, string>(),
  requestIdToTransferId: new Map<string, string>([['send-1', 'transfer-1']]),
  requestIdToDownloadPath: new Map<string, string>(),
  foreignRequestIds: new Set<string>(),
});

const tick = (status: unknown): FileTransferTickNotification =>
  ({ cid: 7n, peer_cid: 42n, status, request_id: 'send-1' }) as FileTransferTickNotification;

const STALLED: { Failed: { code: number; message: string } } = {
  Failed: { code: FILE_TRANSFER_STALLED_CODE, message: 'The other side stopped answering group 2 of this file transfer; the transfer was ended' },
};

describe('a coded transfer failure', () => {
  it('ends the transfer it belongs to, in words for the person', () => {
    expect(parseTickNotification(tick(STALLED), correlation())).toEqual({
      kind: 'complete', direction: 'unknown', transferId: 'transfer-1',
      cid: 7n, peerCid: 42n, success: false, errorMessage: STALLED_TRANSFER_COPY,
    });
  });

  it('is dropped for a stream that is not a chat transfer, like every other tick', () => {
    const ctx: TickCorrelation = correlation();
    ctx.foreignRequestIds.add('send-1');
    expect(parseTickNotification(tick(STALLED), ctx)).toBeNull();
  });

  it('keeps the text-only failure as it was', () => {
    expect(parseTickNotification(tick({ Fail: 'peer declined' }), correlation())).toMatchObject({
      kind: 'complete', success: false, errorMessage: 'peer declined',
    });
  });
});

describe('the reason a failure gives', () => {
  it('is the SDK\'s own message for a code the page has no words for', () => {
    expect(transferFailureReason({ Failed: { code: 12, message: 'refused' } })).toBe('refused');
    expect(transferFailureReason({ Failed: { code: 12, message: '' } })).toBe(UNEXPLAINED_TRANSFER_FAILURE);
  });

  it('is null for every status that is not a failure', () => {
    for (const status of ['TransferBeginning', 'TransferComplete', 'ReceptionComplete', { TransferTick: [1, 2, 3] }, { ReceptionTick: [1, 2, 3] }]) {
      expect(transferFailureReason(status)).toBeNull();
    }
  });
});
