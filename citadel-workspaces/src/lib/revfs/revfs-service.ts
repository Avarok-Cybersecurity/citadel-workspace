/**
 * RE-VFS Service (Singleton)
 *
 * Thin orchestrator that delegates to revfs-dir-ops, revfs-file-ops,
 * and handles incoming operations + sync.
 */

import type {
  RevfsNode,
  RevfsOperation,
  RevfsFileMetadata,
  TreeKey,
} from '@/types/revfs-types';
import { RevfsOpType } from '@/types/revfs-types';
import { withSerialLock } from '@/lib/serial-queue';
import {
  peerTreeKey,
  serverTreeKey,
  legacyPairKey,
} from './tree-operations';
import { RevfsState, type TreeChangedCallback } from './revfs-state';
import { RevfsIO, type RevfsIODeps } from './revfs-io';
import { retryPendingOps, sendAndAwaitAck, type RetryOutcome } from './revfs-retry';
import { wireDrainOnChannelReady } from './drain-on-channel-ready';
import { wireTransferRecords } from './transfer-records';
import { applyInboundOperationSerially, type InboundContext } from './revfs-inbound';
import { awaitTreeChange } from './await-tree-change';
import { answerShareRequest } from './share-on-request';
import { requestShare } from './request-share';
import { sendSharedFile, expectShare, forgetShare } from './share-io';

/** What asking a peer for its tree came to. */
export type SyncOutcome =
  | { kind: 'answered' }
  | { kind: 'unsent' }
  | { kind: 'unanswered'; waitedMs: number };

/** How long a peer has to answer a sync request before we stop claiming it did. */
const SYNC_ANSWER_TIMEOUT_MS: number = 15_000;
import type { DirOpsContext } from './revfs-dir-ops';
import * as dirOps from './revfs-dir-ops';
import type { FileOpsContext } from './revfs-file-ops';
import * as fileOps from './revfs-file-ops';
import * as serverFileOps from './revfs-server-file-ops';
import { readPulledChunk } from './revfs-read-ops';
import { loadTree } from './tree-load';
import type { PulledChunk, RevfsIntentResult } from '@/types/revfs-intents';

export class RevfsService {
  private readonly state: RevfsState = new RevfsState();
  private io: RevfsIO | null = null;
  private initialized: boolean = false;

  // ── Initialization ────────────────────────────────────────────────────

  initialize(deps: RevfsIODeps): void {
    if (this.initialized) return;
    this.io = new RevfsIO(deps);
    this.initialized = true;
    // Queued ops drain when a channel comes up, not only on manual Sync —
    // see drain-on-channel-ready.ts for what sat in the queue without this.
    wireDrainOnChannelReady({
      getCurrentCid: deps.getCurrentCid,
      retryPendingOps: (key: TreeKey, peerCid: bigint) => this.retryPendingOps(key, peerCid),
    });
    // Completed chat transfers fill Sent Files / Received Files.
    wireTransferRecords(this);
  }

  private ensureIO(): RevfsIO {
    if (!this.io) throw new Error('RevfsService not initialized — call initialize() first');
    return this.io;
  }

  // ── Context Builders ──────────────────────────────────────────────────

  private dirCtx(): DirOpsContext {
    return {
      state: this.state,
      ensureIO: () => this.ensureIO(),
      getTree: (myCid, peerCid) => this.getTree(myCid, peerCid),
      getServerTree: (myCid) => this.getServerTree(myCid),
      sendAndAwaitAck: (peerCid, op, key) => this.sendAndAwaitAck(peerCid, op, key),
    };
  }

  private fileCtx(): FileOpsContext {
    return {
      state: this.state,
      ensureIO: () => this.ensureIO(),
      getTree: (myCid, peerCid) => this.getTree(myCid, peerCid),
      getServerTree: (myCid) => this.getServerTree(myCid),
      sendAndAwaitAck: (peerCid, op, key) => this.sendAndAwaitAck(peerCid, op, key),
      sendOp: (peerCid, operation) => this.sendOp(peerCid, operation),
      findFileInTree: (tree, path) => this.findFileInTree(tree, path),
    };
  }

  // ── Tree Access ───────────────────────────────────────────────────────

  /** Throws RevfsTreeUnreadableError when the saved tree cannot be read; see tree-load. */
  async getTree(myCid: bigint, peerCid: bigint): Promise<RevfsNode> {
    const key: TreeKey = peerTreeKey(myCid, peerCid);
    const legacy: TreeKey = legacyPairKey(myCid, peerCid);
    return loadTree(this.state, this.ensureIO(), { key, viewer: myCid, legacyKey: legacy === key ? null : legacy });
  }

  async getServerTree(myCid: bigint): Promise<RevfsNode> {
    return loadTree(this.state, this.ensureIO(), { key: serverTreeKey(myCid), viewer: null, legacyKey: null });
  }

  // ── Peer-Scoped Operations (delegated) ────────────────────────────────

  // Every mutator below is serialised on its tree's key -- see the header of
  // lib/serial-queue for the read-modify-write race this closes, and how bulk
  // delete hit it.
  //
  // Each returns whether the PEER acknowledged the operation, not whether the
  // local tree changed -- the local half is done and persisted either way, and
  // a false is queued for retry. These were `Promise<void>`, so the ack flag
  // `sendAndAwaitAck` was changed to return died here and the file manager
  // reported every peer operation as delivered.
  mkdir(myCid: bigint, peerCid: bigint, path: string): Promise<boolean> { return withSerialLock(peerTreeKey(myCid, peerCid), () => dirOps.peerMkdir(this.dirCtx(), myCid, peerCid, path)); }
  rmdir(myCid: bigint, peerCid: bigint, path: string): Promise<boolean> { return withSerialLock(peerTreeKey(myCid, peerCid), () => dirOps.peerRmdir(this.dirCtx(), myCid, peerCid, path)); }
  rename(myCid: bigint, peerCid: bigint, path: string, newName: string): Promise<boolean> { return withSerialLock(peerTreeKey(myCid, peerCid), () => dirOps.peerRename(this.dirCtx(), myCid, peerCid, path, newName)); }
  move(myCid: bigint, peerCid: bigint, src: string, dest: string): Promise<boolean> { return withSerialLock(peerTreeKey(myCid, peerCid), () => dirOps.peerMove(this.dirCtx(), myCid, peerCid, src, dest)); }
  copy(myCid: bigint, peerCid: bigint, src: string, dest: string): Promise<boolean> { return withSerialLock(peerTreeKey(myCid, peerCid), () => dirOps.peerCopy(this.dirCtx(), myCid, peerCid, src, dest)); }
  uploadFileToPeer(myCid: bigint, peerCid: bigint, dir: string, name: string, meta: RevfsFileMetadata, content: Uint8Array): Promise<boolean> { return withSerialLock(peerTreeKey(myCid, peerCid), () => fileOps.uploadFileToPeer(this.fileCtx(), myCid, peerCid, dir, name, meta, content)); }
  removeFileFromPeer(myCid: bigint, peerCid: bigint, path: string): Promise<boolean> { return withSerialLock(peerTreeKey(myCid, peerCid), () => fileOps.removeFileFromPeer(this.fileCtx(), myCid, peerCid, path)); }
  downloadFileFromPeer(myCid: bigint, peerCid: bigint, path: string): Promise<string | undefined> { return fileOps.downloadFileFromPeer(this.fileCtx(), myCid, peerCid, path); }
  addSentFile(myCid: bigint, peerCid: bigint, t: { fileName: string; fileSize: number; fileType: string; transferId: string }): Promise<void> { return withSerialLock(peerTreeKey(myCid, peerCid), () => fileOps.addSentFile(this.fileCtx(), myCid, peerCid, t)); }
  addReceivedFile(myCid: bigint, peerCid: bigint, t: { fileName: string; fileSize: number; fileType: string; transferId: string; downloadPath?: string }): Promise<void> { return withSerialLock(peerTreeKey(myCid, peerCid), () => fileOps.addReceivedFile(this.fileCtx(), myCid, peerCid, t)); }

  // ── Server-Scoped Operations (delegated) ──────────────────────────────

  serverMkdir(myCid: bigint, path: string): Promise<void> { return withSerialLock(serverTreeKey(myCid), () => dirOps.serverMkdir(this.dirCtx(), myCid, path)); }
  serverRmdir(myCid: bigint, path: string): Promise<void> { return withSerialLock(serverTreeKey(myCid), () => dirOps.serverRmdir(this.dirCtx(), myCid, path)); }
  serverRename(myCid: bigint, path: string, name: string): Promise<void> { return withSerialLock(serverTreeKey(myCid), () => dirOps.serverRename(this.dirCtx(), myCid, path, name)); }
  serverMove(myCid: bigint, src: string, dest: string): Promise<void> { return withSerialLock(serverTreeKey(myCid), () => dirOps.serverMove(this.dirCtx(), myCid, src, dest)); }
  serverCopy(myCid: bigint, src: string, dest: string): Promise<void> { return withSerialLock(serverTreeKey(myCid), () => dirOps.serverCopy(this.dirCtx(), myCid, src, dest)); }
  uploadFileToServer(myCid: bigint, dir: string, name: string, meta: RevfsFileMetadata, content: Uint8Array): Promise<void> { return withSerialLock(serverTreeKey(myCid), () => serverFileOps.uploadFileToServer(this.fileCtx(), myCid, dir, name, meta, content)); }
  removeFileFromServer(myCid: bigint, path: string): Promise<void> { return withSerialLock(serverTreeKey(myCid), () => serverFileOps.removeFileFromServer(this.fileCtx(), myCid, path)); }
  downloadFileFromServer(myCid: bigint, path: string): Promise<string | undefined> { return serverFileOps.downloadFileFromServer(this.fileCtx(), myCid, path); }
  /** A chunk of a file pulled from the peer's storage, or the server's when peerCid is null. */
  readPulledChunk(myCid: bigint, peerCid: bigint | null, path: string, offset: bigint, maxLen: number): Promise<PulledChunk> { return readPulledChunk(this.fileCtx(), myCid, peerCid, path, offset, maxLen); }

  // ── Incoming Operation Handler ────────────────────────────────────────

  /** An operation that arrived from a peer. See revfs-inbound.ts. */
  async handleRevfsOperation(senderCid: bigint, myCid: bigint, op: RevfsOperation): Promise<void> {
    // Serialised against this tree's local mutators; see revfs-inbound.ts for
    // the window that leaves open and why Ack is exempt from it.
    return applyInboundOperationSerially(this.inboundCtx(), senderCid, myCid, op);
  }

  private inboundCtx(): InboundContext {
    return {
      state: this.state,
      ensureIO: () => this.ensureIO(),
      getTree: (mine: bigint, peer: bigint) => this.getTree(mine, peer),
      sendOp: (peer: bigint, operation: RevfsOperation) => this.sendOp(peer, operation),
      answerShareRequest: (asker: bigint, mine: bigint, op: RevfsOperation) => answerShareRequest({
        getTree: (m: bigint, p: bigint) => this.getTree(m, p),
        findFileInTree: (tree: RevfsNode, path: string) => this.findFileInTree(tree, path),
        pull: (m: bigint, p: bigint, path: string) => this.downloadFileFromPeer(m, p, path),
        sendAgentFile: sendSharedFile,
        sendOp: (p: bigint, o: RevfsOperation) => this.sendOp(p, o),
      }, asker, mine, op),
    };
  }

  /** Ask the uploader of a file in our shared storage to send it. See request-share.ts. */
  requestShare(ownerCid: bigint, ownerLabel: string, path: string): Promise<string | undefined> {
    return requestShare({
      expectShare, forgetShare,
      registerAck: (opId: string, timeoutMs: number) => this.state.registerAck(opId, timeoutMs),
      cancelAck: (opId: string) => this.state.cancelAck(opId),
      sendOp: (p: bigint, o: RevfsOperation) => this.sendOp(p, o),
    }, ownerCid, ownerLabel, path);
  }

  // ── Sync ──────────────────────────────────────────────────────────────

  /**
   * Ask a peer for their tree, and wait for it to arrive.
   *
   * Returns true only if the peer's tree actually landed.
   *
   * See `awaitTreeChange` for what "arrived" means and why.
   */
  async requestSync(myCid: bigint, peerCid: bigint, timeoutMs: number = SYNC_ANSWER_TIMEOUT_MS): Promise<SyncOutcome> {
    const answered: Promise<boolean> = awaitTreeChange(this.state, peerTreeKey(myCid, peerCid), timeoutMs);

    const syncReq: RevfsOperation = { op_id: crypto.randomUUID(), op_type: RevfsOpType.SyncRequest, path: '/', timestamp: Date.now() };
    const sent: boolean = await this.sendOp(peerCid, syncReq);
    // Two different failures, and they were one `false`: a request that never
    // left says nothing about the peer, and "the peer did not answer" sent the
    // user to wait for an answer to a question nobody received.
    if (!sent) return { kind: 'unsent' };
    return (await answered) ? { kind: 'answered' } : { kind: 'unanswered', waitedMs: timeoutMs };
  }

  /**
   * Paths whose change has not been acknowledged by the peer yet: queued for
   * retry, or still waiting. The file manager marks them "pending
   * confirmation" instead of either hiding them or implying the peer has them.
   */
  pendingPaths(myCid: bigint, peerCid: bigint): ReadonlySet<string> {
    const paths: Set<string> = new Set<string>();
    for (const entry of this.state.getPendingOps(peerTreeKey(myCid, peerCid))) {
      paths.add(entry.operation.path);
      if (entry.operation.destPath) paths.add(entry.operation.destPath);
    }
    return paths;
  }

  // ── Event Subscription ────────────────────────────────────────────────

  onTreeChanged(callback: TreeChangedCallback): () => void {
    return this.state.onTreeChanged(callback);
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  private async sendAndAwaitAck(peerCid: bigint, op: RevfsOperation, key: TreeKey): Promise<boolean> {
    return sendAndAwaitAck({ state: this.state, io: this.ensureIO(), sendOp: (p: bigint, o: RevfsOperation) => this.sendOp(p, o) }, peerCid, op, key);
  }

  async retryPendingOps(key: TreeKey, peerCid: bigint): Promise<RetryOutcome> {
    return retryPendingOps({ state: this.state, io: this.ensureIO(), sendOp: (p: bigint, op: RevfsOperation) => this.sendOp(p, op) }, key, peerCid);
  }

  private async sendOp(peerCid: bigint, operation: RevfsOperation): Promise<boolean> {
    const io: RevfsIO = this.ensureIO();
    const result: RevfsIntentResult = await io.execute({ type: 'send-revfs-op', peerCid, operation });
    return result.type === 'send-revfs-op' && result.success;
  }

  private findFileInTree(tree: RevfsNode, path: string): RevfsNode | null {
    if (tree.path === path && tree.type === 'file') return tree;
    for (const child of tree.children ?? []) {
      const found: RevfsNode | null = this.findFileInTree(child, path);
      if (found) return found;
    }
    return null;
  }
}

// Singleton
export const revfsService: RevfsService = new RevfsService();
