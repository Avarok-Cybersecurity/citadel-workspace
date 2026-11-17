/**
 * FileTransferService - thin orchestrator over transfer-lifecycle, async-transfers and
 * p2p-transfers. State machine: PENDING -> TRANSFERRING -> COMPLETE (or a terminal failure).
 */

import { scopedSettingsKey } from './settings-key';
import { startExpirySweep } from './expiry-sweep';
import { bindAccountHistory, type TransferHistoryState } from './account-history';
import { loadPersistedTransfers, persistTransfer, persistSettings } from './transfer-persistence';
import { eventEmitter } from '../event-emitter';
import { FileTransferState } from './state';
import { isOpenTransfer } from './transfer-outcome';
import { FileTransferIO } from './io';
import { FILE_TRANSFER_EVENTS } from './events';
import type { IFileTransferIORouter } from './io-router';
import type {
  FileTransfer, FileTransferSettings, TransferProgressEvent,
  IncomingFileTransferMessage,
} from './types';
import { debugLog } from '@/lib/debug-config';
import { handlePeerSignal } from './peer-signals';
import { resendLostTransfer } from './resend-transfer';
import { ProtocolOfferCorrelator } from './protocol-offer-correlation';
import { openPeerChannelViaAutoConnect } from './open-peer-channel';
import { agentNativePicker, agentStagesUploads } from '../agent-conversations/capabilities';
import { sendQueuePort, wireSendQueue } from './send-queue-io';
import { requestedShares, settleSharesOnOutcome } from './requested-shares';
import { sendAgentFile, type AgentFile } from './send-agent-file';
import { handleProtocolProgress, handleProtocolComplete, handleProtocolStatus } from './protocol-transfer-events';
import {
  sendFile, sendFileWithNativePicker, cancelTransfer, acceptTransfer, declineTransfer,
  type LifecycleDeps,
} from './transfer-lifecycle';

export class FileTransferService {
  private static instance: FileTransferService;

  private readonly state: FileTransferState = new FileTransferState();
  private readonly correlator: ProtocolOfferCorrelator = new ProtocolOfferCorrelator((transferId, objectId): void =>
    this.noteJoin(transferId, objectId), (transferId: string): boolean => isOpenTransfer(this.state.getTransfer(transferId)));
  private io: FileTransferIO;
  private initialized: boolean = false;

  private constructor() {
    this.io = new FileTransferIO();
  }

  static getInstance(): FileTransferService {
    return (FileTransferService.instance ??= new FileTransferService());
  }

  setIORouter(router: FileTransferIO): void {
    this.io.dispose();
    this.io = router;
    debugLog('FileTransferService', 'I/O router swapped', { routerType: router.constructor.name });
  }

  getIORouter(): IFileTransferIORouter { return this.io; }

  markForeignOutgoingStream(requestId: string): void {
    this.io.markForeignOutgoingStream(requestId);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.setupMessageHandlers();
    await this.loadFromStorage();
    bindAccountHistory(this.restoring);
    startExpirySweep(this.state, this.emitStateChange.bind(this), this.saveTransfer.bind(this));
    wireSendQueue(this.deps, () => this.io.getCurrentCid());
    this.initialized = true;
    debugLog('FileTransferService', 'Initialized');
  }

  private get deps(): LifecycleDeps {
    return {
      state: this.state,
      io: this.io,
      emitStateChange: this.emitStateChange.bind(this),
      saveTransfer: this.saveTransfer.bind(this),
      saveSettings: this.saveSettings.bind(this),
      openPeerChannel: openPeerChannelViaAutoConnect,
      agentStagesUploads, agentNativePicker,
      queue: sendQueuePort,
    };
  }

  async sendFile(recipientCid: string, file: File): Promise<string> {
    return sendFile(this.deps, recipientCid, file);
  }

  async sendAgentFile(senderCid: bigint, recipientCid: string, file: AgentFile, transferId: string): Promise<string> { return sendAgentFile(this.deps, senderCid, recipientCid, file, transferId); }

  async sendFileWithNativePicker(recipientCid: string, title?: string, allowedExtensions?: string[]): Promise<string> {
    return sendFileWithNativePicker(this.deps, recipientCid, title, allowedExtensions);
  }

  /** The sender's one click for a send a reload lost; see resend-transfer.ts. */
  async resendLostTransfer(transferId: string, file: File): Promise<string> {
    return resendLostTransfer({ ...this.deps, getTransfer: (id: string) => this.state.getTransfer(id), sendFile: (to: string, f: File) => this.sendFile(to, f) }, transferId, file);
  }

  async cancelTransfer(transferId: string): Promise<void> {
    return cancelTransfer(this.deps, transferId);
  }

  async acceptTransfer(transferId: string): Promise<void> {
    return acceptTransfer(this.deps, transferId);
  }

  async declineTransfer(transferId: string, reason?: string): Promise<void> {
    return declineTransfer(this.deps, transferId, reason);
  }

  // Settings -- scoped per account; see settings-key.ts.
  getSettings(peerCid: string): FileTransferSettings { return this.state.getSettings(scopedSettingsKey(peerCid)); }
  getAutoAccept(peerCid: string): boolean { return this.state.getSettings(scopedSettingsKey(peerCid)).autoAccept; }

  private async updateSetting<K extends keyof FileTransferSettings>(
    peerCid: string, key: K, value: FileTransferSettings[K]
  ): Promise<void> {
    const key_: string = scopedSettingsKey(peerCid);
    const settings: FileTransferSettings = this.state.getSettings(key_);
    settings[key] = value;
    this.state.setSettings(key_, settings);
    await this.saveSettings(key_, settings);
  }

  async setAutoAccept(peerCid: string, enabled: boolean): Promise<void> { await this.updateSetting(peerCid, 'autoAcceptAnswered', true); return this.updateSetting(peerCid, 'autoAccept', enabled); }
  async setMaxFileSize(peerCid: string, maxBytes: number): Promise<void> { return this.updateSetting(peerCid, 'maxFileSize', maxBytes); }
  async setAllowRevfsStorage(peerCid: string, allowed: boolean): Promise<void> { return this.updateSetting(peerCid, 'allowRevfsStorage', allowed); }
  async setRevfsQuota(peerCid: string, quotaBytes: number): Promise<void> { return this.updateSetting(peerCid, 'revfsQuota', quotaBytes); }

  // Query / Retrieval

  onProgress(transferId: string, callback: (p: TransferProgressEvent) => void): () => void {
    return this.state.addProgressCallback(transferId, callback);
  }

  getTransfer(transferId: string): FileTransfer | undefined {
    return this.state.getTransfer(transferId);
  }

  /** See `FileTransferState.noteOfferArriving`. */
  isOfferArriving(transferId: string): boolean {
    return this.state.isOfferArriving(transferId);
  }

  getTransfersForPeer(peerCid: string): FileTransfer[] {
    return this.state.getTransfersForPeer(peerCid);
  }

  getPendingIncoming(): FileTransfer[] {
    return this.state.getPendingIncoming();
  }

  getActiveTransfers(): FileTransfer[] {
    return this.state.getActiveTransfers();
  }

  getAllTransfers(): FileTransfer[] {
    return this.state.getAllTransfers();
  }

  private setupMessageHandlers(): void {
    eventEmitter.on('p2p:file-transfer-message', this.handleFileTransferMessage.bind(this));
    settleSharesOnOutcome();

    // The protocol half of every incoming transfer. Without this subscription
    // nothing ever learned the object_id, so accept could not name the transfer
    // the bytes arrive under — `onTransferRequest` existed with no callers, and
    // `registerTransferMapping` was written for this join and never invoked.
    this.io.onTransferRequest((event) => {
      // name and size are optional on the event type, but the protocol
      // notification always carries both (`metadata.name` / `metadata.file_size`).
      // Without them there is nothing to join on, so say so rather than
      // correlating against undefined and matching the wrong transfer.
      if (event.fileName === undefined || event.fileSize === undefined) {
        debugLog('FileTransferService', 'protocol offer without name/size; cannot correlate', {
          protocolId: event.protocolId,
        });
        return;
      }
      this.correlator.noteProtocolOffer(
        event.protocolId,
        event.peerCid.toString(),
        event.fileName,
        event.fileSize
      );
    });

    // THE PROTOCOL PLANE IS AUTHORITATIVE for moving bytes and reporting on
    // them. The bytes of every transfer travel over the SDK's own file
    // transfer (SendFile / RespondFileTransfer), and its
    // FileTransferTickNotification stream is the only ground truth for
    // progress and completion — the message plane's chunk machinery was an
    // abandoned design that nothing ever emitted, and has been deleted. The
    // message plane keeps exactly the jobs the protocol cannot do: the offer
    // announcement (the recipient's bubble), the decline signal, and cancel.
    //
    // These three subscriptions are what let a transfer reach a terminal
    // state at all. They existed on the router with ZERO subscribers, so
    // every transfer stayed 'pending'/'transferring' forever and the sidebar
    // Files list — which shows `state === 'complete'` incoming transfers —
    // was permanently empty.
    this.io.onProgress((event) => {
      void handleProtocolProgress(this.deps, event);
    });
    this.io.onComplete((event) => {
      void handleProtocolComplete(this.deps, event);
    });
    this.io.onStatusChange((event) => {
      void handleProtocolStatus(this.deps, event);
    });
  }

  private async handleFileTransferMessage(message: IncomingFileTransferMessage): Promise<void> {
    await handlePeerSignal({
      ...this.deps, correlator: this.correlator,
      noteOfferArriving: (id: string): void => this.state.noteOfferArriving(id),
      // An offer this browser asked for (a peer-storage share): same size limit, no prompt.
      getAutoAccept: (cid: string, id: string): boolean => this.getAutoAccept(cid) || requestedShares.isExpected(id),
      acceptTransfer: (id: string): Promise<void> => this.acceptTransfer(id),
    }, message);
  }

  /** An offer's two halves joined: remembered on its record too, so a reload can still answer it. */
  private noteJoin(transferId: string, objectId: string): void {
    this.io.registerTransferMapping(transferId, objectId);
    const transfer: FileTransfer | undefined = this.state.getTransfer(transferId);
    if (transfer?.isIncoming !== true) return;
    transfer.objectId = objectId;
    void this.saveTransfer(transfer);
  }

  /** Restored records go in through here, and what the agent still holds is followed again. */
  private readonly restoring: TransferHistoryState = {
    getTransfer: (id: string): FileTransfer | undefined => this.state.getTransfer(id),
    setTransfer: (transfer: FileTransfer): void => { this.state.setTransfer(transfer); this.io.reattach(transfer); },
    setSettings: (key: string, settings: FileTransferSettings): void => this.state.setSettings(key, settings),
  };

  private emitStateChange(transfer: FileTransfer): void {
    eventEmitter.emit(FILE_TRANSFER_EVENTS.STATE_CHANGED, transfer);
    this.io.notifyStateChange(transfer);
  }

  private async loadFromStorage(): Promise<void> {
    await loadPersistedTransfers(this.restoring);
  }

  private async saveTransfer(transfer: FileTransfer): Promise<void> {
    persistTransfer(transfer);
  }

  private async saveSettings(peerCid: string, settings: FileTransferSettings): Promise<void> {
    persistSettings(peerCid, settings);
  }

}

// Export singleton instance
export const fileTransferService: FileTransferService = FileTransferService.getInstance();

// Auto-initialize
fileTransferService.initialize().catch(err => {
  debugLog('FileTransferService', 'Auto-initialization failed:', err);
});

// Expose for testing
if (typeof window !== 'undefined') {
  window.__fileTransferService = fileTransferService;
}
