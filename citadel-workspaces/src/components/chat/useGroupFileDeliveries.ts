/**
 * The sender's per-member summary, re-read whenever the transfer service
 * reports a change -- the same subscription useTransferView makes for a single
 * transfer, widened to the transfers this share owns.
 */
import { useEffect, useMemo, useReducer } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { fileTransferService, FILE_TRANSFER_EVENTS } from '@/lib/file-transfer';
import type { FileTransfer } from '@/lib/file-transfer/types';
import type { MemberDelivery } from '@/types/group-file-share';
import { summariseDeliveries, type DeliverySummary } from '@/lib/group-conversations/group-file-delivery-state';

export function useGroupFileDeliveries(deliveries: readonly MemberDelivery[]): DeliverySummary {
  const [, rerender] = useReducer((n: number): number => n + 1, 0);
  const ids: Set<string> = useMemo(
    (): Set<string> => new Set(deliveries.flatMap((d: MemberDelivery): string[] => (d.kind === 'offered' ? [d.transferId] : []))),
    [deliveries],
  );

  useEffect((): (() => void) | undefined => {
    if (ids.size === 0) return undefined;
    const onChange = (transfer: FileTransfer): void => {
      if (ids.has(transfer.id)) rerender();
    };
    const offState: () => void = eventEmitter.on(FILE_TRANSFER_EVENTS.STATE_CHANGED, onChange);
    const offDone: () => void = eventEmitter.on(FILE_TRANSFER_EVENTS.COMPLETED, onChange);
    return (): void => { offState(); offDone(); };
  }, [ids]);

  return summariseDeliveries(deliveries, (id: string): FileTransfer | undefined => fileTransferService.getTransfer(id));
}
