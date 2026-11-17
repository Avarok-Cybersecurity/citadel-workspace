/**
 * RE-VFS I/O Router
 *
 * Executes RevfsIntents by calling the appropriate external services.
 * This is the ONLY module that performs side effects for RE-VFS.
 *
 * Network I/O (backend file operations) is delegated to revfs-io-network.ts.
 */

import type { RevfsIntent, RevfsIntentResult } from '@/types/revfs-intents';
import type { RevfsNode, RevfsPendingOp, RevfsOperation } from '@/types/revfs-types';
import { MessagingLayerType } from '@/types/messaging-layer';
import { P2PCommandType, serializeP2PCommand } from '@/types/p2p-types';
import type { P2PCommand, P2PMessagingLayerPayload } from '@/types/p2p-types';
import type { CompressionHint } from 'citadel-workspace-client-ts';
import { compressionHintFor } from '@/lib/p2p/compression-hints';
import { RevfsOpfsStorage } from './opfs-storage';
import { debugLog } from '@/lib/debug-config';
import { backendSendFile, backendDeleteFile } from './revfs-io-network';
import { backendDownloadFile } from './revfs-io-download';
import { backendReadPulledChunk } from './revfs-io-read-chunk';

export interface RevfsIODeps {
  /**
   * Open the P2P channel to a peer, resolving whether it is open. Every peer-scoped
   * intent awaits this first: after a server restart the channel is gone, and a send
   * then failed with "Peer connection for <cid> not found" while a chat message to the
   * same peer -- whose sender opens the channel -- went through.
   */
  openPeerChannel: (peerCid: bigint) => Promise<boolean>;
  sendP2PMessageReliable: (localCid: bigint, peerCid: bigint, message: Uint8Array, compressionHint: CompressionHint | undefined) => Promise<void>;
  getCurrentCid: () => Promise<bigint | null>;
  /** Send an internal service request (SendFile, DownloadFile, DeleteVirtualFile) */
  sendInternalServiceRequest: (request: unknown) => Promise<void>;
}

export class RevfsIO {
  private readonly storage: RevfsOpfsStorage = new RevfsOpfsStorage();
  private readonly deps: RevfsIODeps;

  constructor(deps: RevfsIODeps) {
    this.deps = deps;
  }

  async execute(intent: RevfsIntent): Promise<RevfsIntentResult> {
    const peerCid: bigint | null = 'peerCid' in intent ? intent.peerCid : null;
    // Not opening in time is logged, not thrown: the send itself reports the real outcome.
    if (peerCid !== null && !(await this.deps.openPeerChannel(peerCid))) {
      debugLog('RevfsIO', `P2P channel to ${peerCid} not confirmed open; sending anyway`);
    }
    switch (intent.type) {
      case 'send-revfs-op':
        return this.sendRevfsOp(intent.peerCid, intent.operation);
      case 'persist-tree':
        return this.persistTree(intent.treeKey, intent.tree);
      case 'load-tree':
        return this.loadTree(intent.treeKey);
      case 'persist-pending-ops':
        return this.persistPendingOps(intent.treeKey, intent.ops);
      case 'load-pending-ops':
        return this.loadPendingOps(intent.treeKey);
      case 'backend-send-file':
        return backendSendFile(this.deps, intent.cid, intent.peerCid, intent.fileName, intent.content, intent.virtualDir);
      case 'backend-download-file':
        return backendDownloadFile(this.deps, intent.cid, intent.peerCid, intent.virtualDir);
      case 'backend-delete-file':
        return backendDeleteFile(this.deps, intent.cid, intent.peerCid, intent.virtualDir);
      case 'backend-read-pulled-chunk':
        return backendReadPulledChunk(this.deps, intent);
    }
  }

  private async sendRevfsOp(peerCid: bigint, operation: RevfsOperation): Promise<RevfsIntentResult> {
    try {
      debugLog('RevfsIO', `sendRevfsOp: op=${operation.op_type} path=${operation.path} peerCid=${peerCid}`);
      const localCid: bigint | null = await this.deps.getCurrentCid();
      if (!localCid) throw new Error('No local CID available');
      debugLog('RevfsIO', `sendRevfsOp: localCid=${localCid}`);

      const payload: P2PMessagingLayerPayload = {
        layer: {
          type: MessagingLayerType.RevfsOperation,
          operation,
        },
        sender_cid: localCid,
        recipient_cid: peerCid,
        message_id: operation.op_id,
        index: 0,
      };

      const command: P2PCommand = {
        type: P2PCommandType.MessagingLayerCommand,
        payload,
      };

      const bytes: Uint8Array<ArrayBufferLike> = serializeP2PCommand(command);
      debugLog('RevfsIO', `sendRevfsOp: sending ${bytes.length} bytes to peer ${peerCid}`);
      await this.deps.sendP2PMessageReliable(localCid, peerCid, bytes, compressionHintFor(command));
      debugLog('RevfsIO', 'sendRevfsOp: sent successfully');
      return { type: 'send-revfs-op', success: true };
    } catch (err) {
      debugLog('RevfsIO', 'sendRevfsOp failed:', err);
      return { type: 'send-revfs-op', success: false };
    }
  }

  private async persistTree(key: string, tree: RevfsNode): Promise<RevfsIntentResult> {
    try {
      await this.storage.saveTree(key, tree);
      return { type: 'persist-tree', success: true };
    } catch (err) {
      debugLog('RevfsIO', 'persistTree failed:', err);
      return { type: 'persist-tree', success: false };
    }
  }

  private async loadTree(key: string): Promise<RevfsIntentResult> {
    try {
      const tree: RevfsNode | null = await this.storage.loadTree(key);
      return { type: 'load-tree', tree };
    } catch (err) {
      // Reported, not flattened to `tree: null`. The caller persists a default
      // tree when nothing loaded, which over a readable-but-unread tree is
      // data loss.
      debugLog('RevfsIO', 'loadTree failed; refusing to report an empty tree:', err);
      return { type: 'load-tree', tree: null, unreadable: true };
    }
  }

  private async persistPendingOps(key: string, ops: RevfsPendingOp[]): Promise<RevfsIntentResult> {
    try {
      await this.storage.savePendingOps(key, ops);
      return { type: 'persist-pending-ops', success: true };
    } catch (err) {
      debugLog('RevfsIO', 'persistPendingOps failed:', err);
      return { type: 'persist-pending-ops', success: false };
    }
  }

  private async loadPendingOps(key: string): Promise<RevfsIntentResult> {
    const ops: RevfsPendingOp[] = await this.storage.loadPendingOps(key);
    return { type: 'load-pending-ops', ops };
  }
}
