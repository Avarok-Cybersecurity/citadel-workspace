/**
 * File Transfer State Manager
 *
 * Manages all transfer state without performing I/O.
 * Follows SBIO principle - pure state operations only.
 */

import type {
  FileTransfer,
  FileTransferSettings,
  TransferProgressEvent,
} from './types';
import {
  FILE_TRANSFER_DEFAULT_MAX_SIZE_BYTES,
  REVFS_DEFAULT_QUOTA_BYTES,
} from '@/types/messaging-layer';
import { notifyEach } from '@/lib/notify-listeners';

export class FileTransferState {
  // Active transfers by ID
  private transfers: Map<string, FileTransfer> = new Map();

  // Per-peer settings
  private peerSettings: Map<string, FileTransferSettings> = new Map();

  // Progress callbacks by transfer ID
  private progressCallbacks: Map<string, ((progress: TransferProgressEvent) => void)[]> = new Map();

  // ============================================================================
  // Transfer Operations
  // ============================================================================

  /**
   * Offers announced during this page's life. Their record is written after an
   * await (the session lookup), so a bubble can render in between; without this
   * it would read "no record" as "a restored offer nothing can answer".
   */
  private arrivingOffers: Set<string> = new Set();

  noteOfferArriving(transferId: string): void {
    this.arrivingOffers.add(transferId);
  }

  isOfferArriving(transferId: string): boolean {
    return this.arrivingOffers.has(transferId);
  }

  getTransfer(transferId: string): FileTransfer | undefined {
    return this.transfers.get(transferId);
  }

  setTransfer(transfer: FileTransfer): void {
    this.transfers.set(transfer.id, transfer);
  }

  deleteTransfer(transferId: string): boolean {
    return this.transfers.delete(transferId);
  }

  getAllTransfers(): FileTransfer[] {
    return Array.from(this.transfers.values());
  }

  getTransfersForPeer(peerCid: string): FileTransfer[] {
    return Array.from(this.transfers.values()).filter(
      t => t.senderCid === peerCid || t.recipientCid === peerCid
    );
  }

  getPendingIncoming(): FileTransfer[] {
    return Array.from(this.transfers.values()).filter(
      t => t.isIncoming && t.state === 'pending'
    );
  }

  getActiveTransfers(): FileTransfer[] {
    return Array.from(this.transfers.values()).filter(
      t => ['queued', 'preparing', 'pending', 'transferring'].includes(t.state)
    );
  }

  // ============================================================================
  // Settings Operations
  // ============================================================================

  /** The shape a peer gets when nothing has been saved for them. */
  static readonly DEFAULT_SETTINGS: FileTransferSettings = {
    autoAccept: false,
    autoAcceptAnswered: false,
    maxFileSize: FILE_TRANSFER_DEFAULT_MAX_SIZE_BYTES,
    allowRevfsStorage: true, // Default to true for RE-VFS file browser functionality
    revfsQuota: REVFS_DEFAULT_QUOTA_BYTES,
  };

  getSettings(peerCid: string): FileTransferSettings {
    const stored: FileTransferSettings | undefined = this.peerSettings.get(peerCid);

    // Merge OVER the defaults rather than returning the stored object as-is.
    //
    // These come from localStorage, written by whatever version of the app the
    // user last ran. Returning the blob verbatim means every field added after
    // they saved arrives `undefined`: `allowRevfsStorage` reads as off, silently
    // disabling RE-VFS for that peer, and `revfsQuota` shows as `NaN` MB in the
    // settings UI. Nothing has shipped in that state yet — this closes the class
    // before the next field does it.
    // Known fields only: a field a later version removed (the old per-peer
    // `transferMode`) is dropped on load rather than carried forward.
    const merged: FileTransferSettings = { ...FileTransferState.DEFAULT_SETTINGS };
    for (const key of Object.keys(merged) as Array<keyof FileTransferSettings>) {
      if (stored?.[key] !== undefined) (merged as unknown as Record<string, unknown>)[key] = stored[key];
    }
    return merged;
  }

  setSettings(peerCid: string, settings: FileTransferSettings): void {
    this.peerSettings.set(peerCid, settings);
  }

  // ============================================================================
  // Progress Callbacks
  // ============================================================================

  addProgressCallback(
    transferId: string,
    callback: (progress: TransferProgressEvent) => void
  ): () => void {
    if (!this.progressCallbacks.has(transferId)) {
      this.progressCallbacks.set(transferId, []);
    }
    this.progressCallbacks.get(transferId)?.push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks: ((progress: TransferProgressEvent) => void)[] | undefined = this.progressCallbacks.get(transferId);
      if (callbacks) {
        const index: number = callbacks.indexOf(callback);
        if (index !== -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  getProgressCallbacks(transferId: string): ((progress: TransferProgressEvent) => void)[] {
    return this.progressCallbacks.get(transferId) || [];
  }

  notifyProgressCallbacks(transferId: string, event: TransferProgressEvent): void {
    const callbacks: ((progress: TransferProgressEvent) => void)[] | undefined = this.progressCallbacks.get(transferId);
    if (callbacks) {
      // One subscriber's bug must not stop the others hearing about a transfer.
      // A bare forEach propagates: the first callback to throw ends the loop, so
      // every later subscriber stops receiving progress for the rest of the
      // transfer, and the throw unwinds into whoever reported the progress.
      notifyEach(callbacks, 'file-transfer progress', event);
    }
  }

}

// The pending-file stash, received-chunk buffers and received-file blobs that
// used to live here served the message-plane chunk transfer — a second
// implementation nothing ever emitted (its chunk messages had no producers).
// The bytes of a real transfer never pass through browser state at all: they
// leave inside the SendFile request and arrive on disk at the path the
// ReceptionBeginning tick names.
