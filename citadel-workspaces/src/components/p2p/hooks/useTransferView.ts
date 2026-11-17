/**
 * The bubble's view of its transfer, re-read whenever the service reports a
 * change to it. See `transferView` for why the service's record, not the
 * conversation entry, decides what is shown.
 */
import { useEffect, useReducer } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { fileTransferService, FILE_TRANSFER_EVENTS } from '@/lib/file-transfer';
import { transferView, type OfferSide, type TransferView } from '@/lib/file-transfer/transfer-view';
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { PaneMessage } from '@/lib/chat/transport/chat-transport';

export function useTransferView(message: PaneMessage, side: OfferSide): TransferView {
  const transferId: string | undefined = message.transfer_id;
  const [, rerender] = useReducer((n: number): number => n + 1, 0);

  useEffect((): (() => void) | undefined => {
    if (!transferId) return undefined;
    const onChange = (transfer: FileTransfer): void => {
      if (transfer.id === transferId) rerender();
    };
    const offState: () => void = eventEmitter.on(FILE_TRANSFER_EVENTS.STATE_CHANGED, onChange);
    const offDone: () => void = eventEmitter.on(FILE_TRANSFER_EVENTS.COMPLETED, onChange);
    return (): void => { offState(); offDone(); };
  }, [transferId]);

  const record: FileTransfer | undefined = transferId ? fileTransferService.getTransfer(transferId) : undefined;
  const arriving: boolean = transferId ? fileTransferService.isOfferArriving(transferId) : false;
  return transferView(message, record, arriving, side);
}
