/**
 * Transfers this browser asked a peer to send it.
 *
 * In shared peer storage only the uploader's agent can open a file (RE-VFS is
 * pusher-owned), so downloading the other person's file means asking them to
 * send it (lib/revfs/request-share.ts). Their transfer arrives as an ordinary
 * offer whose id is the request's. It is accepted without a prompt -- the user
 * just asked for it -- subject to the same size limit as any accept, and the
 * request settles with the transfer's outcome.
 */
import type { FileTransfer } from './types';
import { eventEmitter } from '../event-emitter';
import { FILE_TRANSFER_EVENTS } from './events';
import { isTerminalTransferState } from './transfer-outcome';

interface Waiter {
  resolve: (transfer: FileTransfer) => void;
  reject: (error: Error) => void;
}

export class RequestedShares {
  private readonly waiting: Map<string, Waiter> = new Map();

  /** Settles when transfer `transferId` reaches a terminal state. */
  expect(transferId: string): Promise<FileTransfer> {
    return new Promise<FileTransfer>((resolve, reject): void => {
      this.waiting.set(transferId, { resolve, reject });
    });
  }

  /** Whether an offer with this id is one this browser asked for. */
  isExpected(transferId: string): boolean {
    return this.waiting.has(transferId);
  }

  /** Report a transfer's state; a terminal one settles its request. */
  settle(transfer: FileTransfer): void {
    const waiter: Waiter | undefined = this.waiting.get(transfer.id);
    if (!waiter || !isTerminalTransferState(transfer.state)) return;
    this.waiting.delete(transfer.id);
    if (transfer.state === 'complete') {
      waiter.resolve(transfer);
    } else {
      waiter.reject(new Error(transfer.errorMessage ?? `the transfer was ${transfer.state}`));
    }
  }

  /**
   * Stop expecting a transfer for a request that failed before any was sent.
   * Its promise is left unsettled on purpose: the asker has already reported
   * the failure, and rejecting a promise nobody awaits would only add an
   * unhandled rejection. A late offer with this id then gets the usual prompt.
   */
  forget(transferId: string): void {
    this.waiting.delete(transferId);
  }
}

export const requestedShares: RequestedShares = new RequestedShares();

/** A share settles with its transfer: completed (success or failure) or cancelled. */
export function settleSharesOnOutcome(): void {
  const settle = (t: FileTransfer): void => requestedShares.settle(t);
  eventEmitter.on<FileTransfer>(FILE_TRANSFER_EVENTS.COMPLETED, settle);
  eventEmitter.on<FileTransfer>(FILE_TRANSFER_EVENTS.CANCELLED, settle);
}
