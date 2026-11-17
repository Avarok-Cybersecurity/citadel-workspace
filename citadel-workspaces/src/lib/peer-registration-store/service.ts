/**
 * Peer Registration Store - Service (Orchestrator)
 *
 * Thin class that wires together state, persistence, lifecycle, and event-handler modules.
 * Preserves the original public API surface and singleton pattern.
 */

import { eventEmitter } from '../event-emitter';
import { clearNotificationsFor } from './notification-cleanup';
import { recordWithoutLosingIt } from './record-incoming';
import { instanceManager } from '../multi-instance';
import { debugLog } from '@/lib/debug-config';
import { addOutgoing, removeOutgoing, removeOutgoingForPeer, type OutgoingContext } from './outgoing-mutations';
import { OUTGOING_POLL_INTERVAL_MS } from './constants';
import type {
  PendingPeerRequest,
  OutgoingPeerRequest,
  KVPendingEntry,
  PeerRegisterNotification,
} from './types';
import {
  getCurrentSessionCid,
  getFilteredPendingRequests,
  getFilteredPendingCount,
  hasRequestFromPeer as hasRequestFromPeerFn,
  hasOutgoingRequestTo as hasOutgoingRequestToFn,
  getFilteredOutgoingRequests,
  getOutgoingRequestCidSet,
  removePendingById,
  removePendingByPeerCid,
} from './state';
import {
  persistPendingToLocalDB,
  loadPendingFromLocalDB,
  persistOutgoingToLocalDB,
  loadOutgoingFromLocalDB,
} from './persistence';
import { everyKeyWasRead } from './initialisation';
import type { LoadOutcome } from './local-db-client';
import {
  createNotificationWithCallbacks,
  processIncomingNotification,
  executeAcceptRequest,
  executeDeclineRequest,
  processPollRequest,
} from './lifecycle';
import { setupEventListeners } from './event-handlers';

class PeerRegistrationStore {
  private static instance: PeerRegistrationStore;
  private pendingRequests: PendingPeerRequest[] = [];
  private outgoingRequests: OutgoingPeerRequest[] = [];
  private pendingKVRequests: Map<string, KVPendingEntry> = new Map<string, KVPendingEntry>();
  private isInitializedFlag: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private pollIntervalId: NodeJS.Timeout | null = null;

  private constructor() {
    setupEventListeners({
      refreshNotificationsForCurrentSession: () => this.refreshNotificationsForCurrentSession(),
      startPollLoop: () => this.startPollLoop(),
      stopPollLoop: () => this.stopPollLoop(),
      removeOutgoingRequestByPeer: (cid) => this.removeOutgoingRequestByPeer(cid),
      removeOutgoingRequest: (id) => this.removeOutgoingRequest(id),
      removeRequestByPeerCid: (cid) => this.removeRequestByPeerCid(cid),
      isInitialized: () => this.isInitializedFlag,
      getPendingKVRequests: () => this.pendingKVRequests,
    });
  }

  public static getInstance(): PeerRegistrationStore {
    if (!PeerRegistrationStore.instance) {
      PeerRegistrationStore.instance = new PeerRegistrationStore();
    }
    return PeerRegistrationStore.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitializedFlag) return;
    if (this.initializationPromise) return this.initializationPromise;
    let bothRead: boolean = false;
    this.initializationPromise = (async (): Promise<void> => {
      const outcomes: LoadOutcome[] = await Promise.all(
        [this.loadFromLocalDB(), this.loadOutgoingFromLocalDB()]);
      bothRead = everyKeyWasRead(outcomes);
      if (!bothRead) debugLog('PeerRegistrationStore',
        `Not every key was read (${outcomes.join(', ')}); staying uninitialised to retry`);
      this.startPollLoop();
    })();
    await this.initializationPromise;
    // See initialisation.ts for why a failed read must not latch.
    this.isInitializedFlag = bothRead;
    this.initializationPromise = null;
  }

  public startPollLoop(): void {
    if (!instanceManager.isLeader) { debugLog('PeerRegistrationStore', 'Poll loop not started (not leader tab)'); return; }
    if (this.pollIntervalId) { debugLog('PeerRegistrationStore', 'Poll loop already running'); return; }
    debugLog('PeerRegistrationStore', 'Starting poll loop (interval:', OUTGOING_POLL_INTERVAL_MS, 'ms)');
    this.pollIntervalId = setInterval(() => {
      this.pollAndResend().catch(err => debugLog('PeerRegistrationStore', 'Poll loop error:', err));
    }, OUTGOING_POLL_INTERVAL_MS);
  }

  public stopPollLoop(): void {
    if (this.pollIntervalId) { clearInterval(this.pollIntervalId); this.pollIntervalId = null; debugLog('PeerRegistrationStore', 'Stopped poll loop'); }
  }

  public async getPendingRequests(): Promise<PendingPeerRequest[]> { return getFilteredPendingRequests(this.pendingRequests); }
  public async getPendingCount(): Promise<number> { return getFilteredPendingCount(this.pendingRequests); }
  public hasRequestFromPeer(peerCid: bigint, targetCid?: bigint): boolean { return hasRequestFromPeerFn(this.pendingRequests, peerCid, targetCid); }
  public hasOutgoingRequestTo(peerCid: bigint, fromCid?: bigint): boolean { return hasOutgoingRequestToFn(this.outgoingRequests, peerCid, fromCid); }
  public async getOutgoingRequests(): Promise<OutgoingPeerRequest[]> { return getFilteredOutgoingRequests(this.outgoingRequests); }
  public async getOutgoingRequestCids(): Promise<Set<bigint>> { return getOutgoingRequestCidSet(this.outgoingRequests); }

  private outgoingCtx(): OutgoingContext {
    return {
      requests: this.outgoingRequests,
      kv: this.pendingKVRequests,
      setRequests: (next: OutgoingPeerRequest[]): void => { this.outgoingRequests = next; },
      broadcast: (): Promise<void> => this.emitOutgoingUpdate(),
    };
  }

  public async addOutgoingRequest(request: OutgoingPeerRequest): Promise<void> {
    return addOutgoing(this.outgoingCtx(), request);
  }

  public async removeOutgoingRequest(requestId: string): Promise<OutgoingPeerRequest | null> {
    return removeOutgoing(this.outgoingCtx(), requestId);
  }

  public async removeOutgoingRequestByPeer(peerCid: bigint, fromCid?: bigint): Promise<void> {
    return removeOutgoingForPeer(this.outgoingCtx(), peerCid, fromCid);
  }

  public async handleIncomingRequest(notification: PeerRegisterNotification): Promise<void> {
    const request: PendingPeerRequest | null = processIncomingNotification(this.pendingRequests, notification);
    if (!request) return;
    this.pendingRequests.push(request);
    debugLog('PeerRegistrationStore', '[P2P] Added pending request', request);
    await recordWithoutLosingIt(request, this.pendingRequests, this.pendingKVRequests, (r) =>
      this.createNotificationForRequest(r),
    );
    await this.emitUpdate();
  }

  public async acceptRequest(requestId: string): Promise<void> {
    const request: PendingPeerRequest | undefined = this.pendingRequests.find(r => r.id === requestId);
    if (!request) throw new Error('Request not found');
    await executeAcceptRequest(request);
    await this.removeRequest(requestId);
    debugLog('PeerRegistrationStore', 'Accepted request from', request.peer_username);
  }

  public async declineRequest(requestId: string): Promise<void> {
    const request: PendingPeerRequest | undefined = this.pendingRequests.find(r => r.id === requestId);
    if (!request) throw new Error('Request not found');
    // Tell the sender. Removing the local entry was the whole of decline, so a
    // declined request came back every five minutes forever — see
    // executeDeclineRequest.
    await executeDeclineRequest(request);
    await this.removeRequest(requestId);
    debugLog('PeerRegistrationStore', 'Declined request from', request.peer_username);
  }

  public async removeRequestByPeerCid(peerCid: bigint): Promise<void> {
    const before: PendingPeerRequest[] = this.pendingRequests;
    this.pendingRequests = removePendingByPeerCid(this.pendingRequests, peerCid);
    if (this.pendingRequests.length !== before.length) {
      debugLog('PeerRegistrationStore', 'Removed requests from peer', peerCid.toString());
      clearNotificationsFor(before, this.pendingRequests);
      await this.emitUpdate();
      await persistPendingToLocalDB(this.pendingRequests, this.pendingKVRequests);
    }
  }

  public async refreshNotificationsForCurrentSession(): Promise<void> {
    const requests: PendingPeerRequest[] = await this.getPendingRequests();
    for (const r of requests) this.createNotificationForRequest(r);
    await this.emitUpdate();
  }

  private createNotificationForRequest(request: PendingPeerRequest): void {
    createNotificationWithCallbacks(
      request,
      (id) => this.acceptRequest(id),
      (id) => this.declineRequest(id),
    );
  }

  private async removeRequest(requestId: string): Promise<void> {
    const before: PendingPeerRequest[] = this.pendingRequests;
    this.pendingRequests = removePendingById(this.pendingRequests, requestId);
    clearNotificationsFor(before, this.pendingRequests);
    // Announce first: a write that times out or is refused must not keep a
    // removed request on screen until reload. The rejection still reaches the caller.
    await this.emitUpdate();
    await persistPendingToLocalDB(this.pendingRequests, this.pendingKVRequests);
  }

  private async pollAndResend(): Promise<void> {
    if (!instanceManager.isLeader) return;
    await this.loadOutgoingFromLocalDB();
    const now: number = Date.now();
    if (this.outgoingRequests.length === 0) return;
    debugLog('PeerRegistrationStore', 'Poll checking', this.outgoingRequests.length, 'outgoing requests');
    let needsPersist: boolean = false;
    for (const request of this.outgoingRequests) {
      const result: "remove" | "updated" | "skip" = await processPollRequest(request, now);
      if (result === 'remove') { await this.removeOutgoingRequest(request.id); needsPersist = true; }
      else if (result === 'updated') { needsPersist = true; }
    }
    if (needsPersist) await persistOutgoingToLocalDB(this.outgoingRequests, this.pendingKVRequests);
  }

  private async loadFromLocalDB(): Promise<LoadOutcome> {
    return loadPendingFromLocalDB(this.pendingKVRequests, async (requests) => {
      this.pendingRequests = requests;
      debugLog('PeerRegistrationStore', 'Loaded', requests.length, 'pending requests');
      const current: PendingPeerRequest[] = await this.getPendingRequests();
      for (const r of current) this.createNotificationForRequest(r);
      await this.emitUpdate();
    });
  }

  private async loadOutgoingFromLocalDB(): Promise<LoadOutcome> {
    return loadOutgoingFromLocalDB(this.pendingKVRequests, async (requests) => {
      this.outgoingRequests = requests;
      debugLog('PeerRegistrationStore', 'Loaded', requests.length, 'valid outgoing requests');
      await this.emitOutgoingUpdate();
    });
  }

  private async emitUpdate(): Promise<void> {
    const currentCid: bigint | null = await getCurrentSessionCid();
    const currentSessionRequests: PendingPeerRequest[] = await this.getPendingRequests();
    debugLog('PeerRegistrationStore', `[P2P] emitUpdate: currentCid=${currentCid?.toString()}, total=${this.pendingRequests.length}, filtered=${currentSessionRequests.length}`);
    eventEmitter.emit('peer-requests:updated', { requests: currentSessionRequests, count: currentSessionRequests.length });
  }

  private async emitOutgoingUpdate(): Promise<void> {
    const out: OutgoingPeerRequest[] = await this.getOutgoingRequests();
    eventEmitter.emit('outgoing-peer-requests:updated', { requests: out, cids: new Set(out.map(r => r.toCid)) });
  }
}

export const peerRegistrationStore: PeerRegistrationStore = PeerRegistrationStore.getInstance();
export { PeerRegistrationStore };
