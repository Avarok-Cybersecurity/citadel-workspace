/**
 * What a file-transfer bubble shows, decided in one place.
 *
 * The bubble rendered `message.transfer_state` — the state stamped on the
 * conversation entry when the offer arrived. That entry is what the page store
 * persists and restores, and nothing writes later states back into it, so
 * after a reload every offer came back as 'pending' with a live Accept button:
 * hours-old offers the browser could no longer answer (the object_id join is
 * in memory and the agent does not re-announce), whose Accept threw "Transfer
 * not found". The service's record is the authority on a transfer's state and
 * its reason, so it wins whenever it exists.
 *
 * It also carries the reason. A failed transfer's record holds the Fail tick's
 * message, but the bubble read `message.error`, which nothing sets — so it said
 * "Transfer failed" and never why.
 */
import type { FileTransfer } from './types';
import { waitingText } from './send-queue';
import { isTerminalTransferState } from './transfer-outcome';
import { fromStoredState, type StoredTransferState } from './stored-state';
import type { FileTransferState as TransferLifecycleState } from '@/types/messaging-layer';

export const STALE_OFFER_REASON: string = 'Offer expired — ask the sender to send it again.';
/** The sender's own copy: telling them to ask the sender was telling them to ask themselves. */
export const STALE_SENT_OFFER_REASON: string = 'Offer expired before it was accepted — send the file again.';

/** Which side of the conversation is reading the bubble. */
export type OfferSide = 'sent' | 'received';

export interface TransferView {
  state: TransferLifecycleState;
  progress: number;
  reason: string | undefined;
  /** Picked up again after a reload and not yet heard from (reload-recovery.ts). */
  resuming: boolean;
  /** Ended by a reload with nothing kept: the sender may send it again in one click. */
  resendable: boolean;
}

/** The fields of a conversation entry that describe its transfer. */
export interface TransferMessageFields {
  transfer_state?: StoredTransferState;
  transfer_progress?: number;
  error?: string;
}

const AWAITING_ANSWER: ReadonlySet<TransferLifecycleState> = new Set<TransferLifecycleState>(['queued', 'pending']);

/**
 * @param record the service's record for the entry's transfer, if it has one
 * @param offerArriving whether the offer was announced during this page's life
 *   and its record is still being written
 * @param side whether the reader sent this offer or received it
 */
export function transferView(
  message: TransferMessageFields,
  record: FileTransfer | undefined,
  offerArriving: boolean,
  side: OfferSide
): TransferView {
  if (record) {
    const reason: string | undefined = record.state === 'queued' ? waitingText(record.waitingFor ?? 'your contact') : record.errorMessage;
    return {
      state: record.state, progress: record.progress, reason,
      resuming: record.resuming === true && !isTerminalTransferState(record.state),
      resendable: side === 'sent' && record.resendable === true && record.state === 'error',
    };
  }
  const state: TransferLifecycleState = message.transfer_state === undefined ? 'pending' : fromStoredState(message.transfer_state);
  // An offer with no record that did not arrive in this page's life is one
  // restored from storage: there is nothing left that could accept it.
  if (AWAITING_ANSWER.has(state) && !offerArriving) {
    return { state: 'expired', progress: 0, reason: side === 'sent' ? STALE_SENT_OFFER_REASON : STALE_OFFER_REASON, resuming: false, resendable: false };
  }
  return { state, progress: message.transfer_progress ?? 0, reason: message.error, resuming: false, resendable: false };
}
