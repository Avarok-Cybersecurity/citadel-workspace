/**
 * The transfers the panel lists, re-read whenever the service reports a change,
 * with each one's rate derived from its successive progress reports.
 */
import { useEffect, useReducer, useRef, type MutableRefObject } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { fileTransferService, FILE_TRANSFER_EVENTS } from '@/lib/file-transfer';
import type { FileTransfer } from '@/lib/file-transfer/types';
import { bytesMoved, nextRate, type RateState } from '@/lib/file-transfer/transfer-rate';
import { activeCount, transferRow, transfersShown, type TransferRow } from './transfer-rows';

export interface Transfers {
  rows: TransferRow[];
  active: number;
}

export function useTransfers(nameOf: (cid: string) => string): Transfers {
  const [, rerender] = useReducer((n: number): number => n + 1, 0);
  const rates: MutableRefObject<Map<string, RateState>> = useRef(new Map<string, RateState>());

  useEffect((): (() => void) => {
    const onChange = (transfer: FileTransfer): void => {
      if (transfer.state === 'transferring') {
        const sample: { bytes: number; at: number } = { bytes: bytesMoved(transfer.progress, transfer.fileSize), at: transfer.updatedAt };
        rates.current.set(transfer.id, nextRate(rates.current.get(transfer.id), sample));
      } else {
        rates.current.delete(transfer.id);
      }
      rerender();
    };
    const offState: () => void = eventEmitter.on(FILE_TRANSFER_EVENTS.STATE_CHANGED, onChange);
    const offDone: () => void = eventEmitter.on(FILE_TRANSFER_EVENTS.COMPLETED, onChange);
    return (): void => { offState(); offDone(); };
  }, []);

  const all: FileTransfer[] = fileTransferService.getAllTransfers();
  return {
    rows: transfersShown(all).map((t: FileTransfer): TransferRow =>
      transferRow(t, rates.current.get(t.id)?.bytesPerSecond ?? null, nameOf, undefined)),
    active: activeCount(all),
  };
}
