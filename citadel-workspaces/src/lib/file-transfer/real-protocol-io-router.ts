/** Real Protocol I/O Router - delegates to send-operations and receive-operations. */

import { eventEmitter } from '../event-emitter';
import { getSelectedUser } from '../tab-context';
import { p2pMessengerManager } from '../p2p';
import type { IFileTransferIORouter } from './io-router';
import type {
  SendFileParams, SendFileResult, CancelTransferParams, RespondTransferParams,
  DownloadFileParams, TransferRequestEvent, TransferProgressEvent,
  TransferCompleteEvent, TransferStatusEvent,
} from './io-router-types';
import type { FileTransfer } from './types';
import { toStoredState } from './stored-state';
import { executeSendFile, executeCancelTransfer } from './send-operations';
import {
  executeRespondToTransfer, executeDownloadFile, createTransferRequestHandler,
  createProgressHandler, createCompleteHandler, createStatusChangeHandler,
} from './receive-operations';
import type { TickCorrelation } from './tick-events';
import type { TabUserContext } from '@/lib/tab-context';

export class RealProtocolIORouter implements IFileTransferIORouter {
  private subscriptions: Map<string, () => void> = new Map<string, () => void>();
  private disposed: boolean = false;

  // Map client transferId to protocol objectId for correlation
  protected transferIdToObjectId: Map<string, string> = new Map<string, string>();
  /** Accepts waiting for their transfer's protocol half; see awaitObjectId. */
  private objectIdWaiters: Map<string, Array<(objectId: string | undefined) => void>> = new Map();
  protected objectIdToTransferId: Map<string, string> = new Map<string, string>();

  /**
   * Correlation state for the id-less tick stream (see tick-events.ts):
   * the ticks and completes that report a transfer's progress carry no
   * object id on the wire, only the notification's request_id — which for
   * an accepted reception is the RespondFileTransfer request UUID. These
   * maps join that UUID (and the download path ReceptionBeginning reveals)
   * back to the client transfer id.
   */
  private readonly tickCorrelation: TickCorrelation = {
    objectIdToTransferId: this.objectIdToTransferId,
    requestIdToTransferId: new Map<string, string>(),
    requestIdToDownloadPath: new Map<string, string>(),
    foreignRequestIds: new Set<string>(),
  };

  async sendFile(params: SendFileParams): Promise<SendFileResult> {
    const result: SendFileResult = await executeSendFile(params);
    this.noteOutgoingStream(result.requestId, params.transferId);
    return result;
  }

  /**
   * Join a SendFile's request id to its chat transfer: the agent names that id on
   * every sender tick, and on a later SendFileRequestFailure (createStatusChangeHandler).
   */
  protected noteOutgoingStream(requestId: string, transferId: string): void {
    this.tickCorrelation.requestIdToTransferId.set(requestId, transferId);
  }

  async cancelTransfer(params: CancelTransferParams): Promise<void> {
    executeCancelTransfer(params, this.transferIdToObjectId, this.objectIdToTransferId);
  }

  /** Resolves to the request id the accepted stream's ticks will carry. */
  async respondToTransfer(params: RespondTransferParams): Promise<string> {
    const requestId: string = await executeRespondToTransfer(params);
    // An accept spawns the reception tick stream under this request UUID.
    // Register the join BEFORE any tick can arrive (the WebSocket is ordered,
    // so nothing for this stream precedes the request we just sent).
    if (params.accept && params.transferId) {
      this.tickCorrelation.requestIdToTransferId.set(requestId, params.transferId);
    }
    return requestId;
  }

  async downloadFile(params: DownloadFileParams): Promise<void> {
    return executeDownloadFile(params);
  }

  /**
   * Mark an OUTGOING tick stream as NOT a chat transfer, so its ticks and
   * completes are dropped instead of falling back to the oldest live transfer
   * for the same peer pair (see protocol-transfer-events.ts).
   *
   * The incoming path recognises a foreign stream by itself at
   * ReceptionBeginning, whose metadata names the transfer_type. Sender-side
   * variants carry no metadata at all, so the only party who knows the stream
   * is foreign is the code that initiates it — a revfs push's ticks come back
   * stamped with the originating SendFile request_id (the internal service
   * reclaims it in object_transfer_handle.rs via `take_push`). Must be called
   * BEFORE the SendFile request is sent; the WebSocket is ordered, so no tick
   * for the stream can precede the registration.
   */
  markForeignOutgoingStream(requestId: string): void {
    this.tickCorrelation.foreignRequestIds.add(requestId);
  }

  onTransferRequest(callback: (event: TransferRequestEvent) => void): () => void {
    const handler: (message: Record<string, unknown>) => void = createTransferRequestHandler(callback);
    eventEmitter.on('websocket-message', handler);
    const unsubscribe = (): void => eventEmitter.off('websocket-message', handler);
    this.subscriptions.set(`request-${Date.now()}`, unsubscribe);
    return unsubscribe;
  }

  onProgress(callback: (event: TransferProgressEvent) => void): () => void {
    const handler: (message: Record<string, unknown>) => void = createProgressHandler(callback, this.tickCorrelation);
    eventEmitter.on('websocket-message', handler);
    const unsubscribe = (): void => eventEmitter.off('websocket-message', handler);
    this.subscriptions.set(`progress-${Date.now()}`, unsubscribe);
    return unsubscribe;
  }

  onComplete(callback: (event: TransferCompleteEvent) => void): () => void {
    const handler: (message: Record<string, unknown>) => void = createCompleteHandler(callback, this.tickCorrelation);
    eventEmitter.on('websocket-message', handler);
    const unsubscribe = (): void => eventEmitter.off('websocket-message', handler);
    this.subscriptions.set(`complete-${Date.now()}`, unsubscribe);
    return unsubscribe;
  }

  onStatusChange(callback: (event: TransferStatusEvent) => void): () => void {
    const handler: (message: Record<string, unknown>) => void = createStatusChangeHandler(callback, this.tickCorrelation);
    eventEmitter.on('websocket-message', handler);
    const unsubscribe = (): void => eventEmitter.off('websocket-message', handler);
    this.subscriptions.set(`status-${Date.now()}`, unsubscribe);
    return unsubscribe;
  }

  // ============================================================================
  // File Utilities
  // ============================================================================

  async generateThumbnail(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader: FileReader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>): void => {
        const img: HTMLImageElement = new Image();
        img.onload = (): void => {
          const canvas: HTMLCanvasElement = document.createElement('canvas');
          const MAX_SIZE: number = 100;
          let width: number = img.width;
          let height: number = img.height;

          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx: ReturnType<typeof canvas.getContext> = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          } else {
            reject(new Error('Could not get canvas context'));
          }
        };
        img.onerror = (): void => reject(new Error('Could not load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = (): void => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  // ============================================================================
  // Context
  // ============================================================================

  async getCurrentCid(): Promise<bigint | null> {
    const tabSelection: TabUserContext | null = await getSelectedUser();
    if (tabSelection?.selectedCid) {
      return tabSelection.selectedCid;
    }
    return null;
  }

  notifyStateChange(transfer: FileTransfer): void {
    const peerCid: string = transfer.isIncoming ? transfer.senderCid : transfer.recipientCid;
    p2pMessengerManager.updateFileTransferState(BigInt(peerCid), transfer.id, {
      transfer_state: toStoredState(transfer.state),
      transfer_progress: transfer.progress,
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * The object_id once the two halves join, waiting up to `timeoutMs` for it; undefined if they
   * never do. For a large file the bubble arrives seconds before the protocol offer (the sender
   * announces, then stages the bytes), so an accept pressed at once must wait rather than fail.
   */
  protected awaitObjectId(transferId: string, timeoutMs: number): Promise<string | undefined> {
    const known: string | undefined = this.transferIdToObjectId.get(transferId);
    if (known !== undefined) return Promise.resolve(known);
    return new Promise((resolve) => {
      const done = (objectId: string | undefined): void => { clearTimeout(timer); resolve(objectId); };
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        this.objectIdWaiters.set(transferId, (this.objectIdWaiters.get(transferId) ?? []).filter((w) => w !== done));
        resolve(undefined);
      }, timeoutMs);
      this.objectIdWaiters.set(transferId, [...(this.objectIdWaiters.get(transferId) ?? []), done]);
    });
  }

  registerTransferMapping(transferId: string, objectId: string): void {
    this.transferIdToObjectId.set(transferId, objectId);
    this.objectIdToTransferId.set(objectId, transferId);
    const waiters: Array<(objectId: string | undefined) => void> = this.objectIdWaiters.get(transferId) ?? [];
    this.objectIdWaiters.delete(transferId);
    for (const release of waiters) release(objectId);
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const unsubscribe of this.subscriptions.values()) {
      unsubscribe();
    }
    this.subscriptions.clear();

    this.transferIdToObjectId.clear();
    this.objectIdToTransferId.clear();
    for (const waiters of this.objectIdWaiters.values()) for (const release of waiters) release(undefined);
    this.objectIdWaiters.clear();
    this.tickCorrelation.requestIdToTransferId.clear();
    this.tickCorrelation.requestIdToDownloadPath.clear();
    this.tickCorrelation.foreignRequestIds.clear();
  }
}
