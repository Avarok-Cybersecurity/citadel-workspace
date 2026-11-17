/**
 * Instance Manager
 *
 * Tracks this instance's identity and state in the multi-instance architecture.
 * Each browser tab/window is an "instance" identified by a unique instanceId.
 * Each instance can own at most one session (CID) at a time.
 *
 * Key concepts:
 * - instanceId: Unique identifier for this tab (persisted in sessionStorage)
 * - cid: The session this instance "owns" (set after login/claim)
 * - isLeader: Whether this instance manages the WebSocket
 * - leaderId: The instanceId of the current leader
 */

import { eventEmitter } from '../event-emitter';
import { sessionGet, sessionSet } from '@/lib/safe-session-storage';
import { debugLog } from '@/lib/debug-config';
import type { InstanceState, InstanceInfo } from './instance-manager-types';
import { documentNonce, mintInstanceId } from './instance-identity';

export type { InstanceState, InstanceInfo } from './instance-manager-types';
import * as registry from './instance-registry';

const INSTANCE_ID_KEY: "citadel-instance-id" = 'citadel-instance-id';

class InstanceManager {
  private static instance: InstanceManager;

  private _instanceId: string;
  private _cid: bigint | null = null;
  private _isLeader: boolean = false;
  private _leaderId: string | null = null;

  // Map of instanceId -> CID for all known instances
  private knownInstances: Map<string, bigint | null> = new Map();

  private constructor() {
    this._instanceId = this.getOrCreateInstanceId();
    this.knownInstances.set(this._instanceId, null);
    this.setupEventListeners();

    debugLog('InstanceManager', `[InstanceManager] Initialized with instanceId: ${this._instanceId}`);
  }

  public static getInstance(): InstanceManager {
    if (!InstanceManager.instance) {
      InstanceManager.instance = new InstanceManager();
    }
    return InstanceManager.instance;
  }

  /**
   * Get or create a unique instance ID for this tab
   * Persisted in sessionStorage so it survives a page reload. NOT unique on its
   * own: Duplicate Tab copies sessionStorage, so a twin boots with this exact
   * id — see instance-identity.ts and `reissueInstanceId`.
   *
   * Format: Pure BigInt-compatible string (timestamp_ms * 10^6 + random)
   * This enables deterministic leader election where highest ID wins
   */
  private getOrCreateInstanceId(): string {
    // Through the guarded accessors: `sessionStorage` throws outright under
    // strict privacy settings and some embedded contexts, and this runs during
    // boot. Unguarded it rendered a blank page -- see safe-session-storage.
    const stored: string | null = sessionGet(INSTANCE_ID_KEY);
    if (stored) return stored;

    const minted: string = mintInstanceId();
    if (!sessionSet(INSTANCE_ID_KEY, minted)) {
      // Storage refused. The id still has to be stable for this document, or
      // leader election re-rolls it on every read and no tab ever wins.
      this.inMemoryInstanceId = minted;
    }
    return this.inMemoryInstanceId ?? minted;
  }

  /** Only when sessionStorage refuses; see getOrCreateInstanceId. */
  private inMemoryInstanceId: string | null = null;

  /** This document's non-persisted marker. See instance-identity.ts. */
  get documentNonce(): string {
    return documentNonce;
  }

  /**
   * Take a new instance id because another document is using ours.
   *
   * Duplicate Tab copies sessionStorage, so the twin's id is identical and the
   * channel's self-filter hides each from the other — both then elect
   * themselves leader and open a second WebSocket. Re-rolling here is what
   * makes them distinguishable so exactly one wins.
   */
  reissueInstanceId(): string {
    const replacement: string = mintInstanceId();
    this.replaceInstanceId(replacement);
    debugLog('InstanceManager', `Instance id re-issued (duplicate detected): ${replacement}`);
    return replacement;
  }

  /**
   * Take `lower` so a protocol-1 leader yields to this tab (legacy-v1-put-down.ts). Unlike a
   * twin's reissue, the id given up was this tab's alone, so messages still addressed to it
   * (acks and forwards in flight) are this tab's to answer: see isOwnInstanceId.
   */
  takeLowerInstanceId(lower: string): void {
    // This tab's own registry entry moves with it, or the leader routes its CID to a dead id.
    // (A twin's reissue leaves it: that key is the twin's id too, and the twin still holds it.)
    this.formerIds.add(this._instanceId);
    this.knownInstances.delete(this._instanceId);
    this.replaceInstanceId(lower);
    this.knownInstances.set(lower, this._cid);
  }

  isOwnInstanceId(instanceId: string): boolean {
    return instanceId === this._instanceId || this.formerIds.has(instanceId);
  }

  private readonly formerIds: Set<string> = new Set<string>();

  private replaceInstanceId(replacement: string): void {
    // Storage refused; the replacement must still take effect for this document.
    if (!sessionSet(INSTANCE_ID_KEY, replacement)) this.inMemoryInstanceId = replacement;
    this._instanceId = replacement;
  }

  private setupEventListeners(): void {
    eventEmitter.on('instance:leader-changed', (data: { isLeader: boolean; leaderId: string }) => {
      this._isLeader = data.isLeader;
      this._leaderId = data.leaderId;

      debugLog('InstanceManager', `[InstanceManager] Leader changed - isLeader: ${this._isLeader}, leaderId: ${this._leaderId}`);

      eventEmitter.emit('instance:state-changed', this.getState());
    });

    // There was an 'instance:registry-update' listener here that set the same
    // entry. Nothing ever emitted it; the registry is really maintained through
    // registerInstance(), called from channel-messaging and route-by-request-id.
    // Two ways to write one map, one of them dead.

    eventEmitter.on('instance:disconnected', (data: { instanceId: string }) => {
      this.knownInstances.delete(data.instanceId);
      debugLog('InstanceManager', `[InstanceManager] Instance disconnected: ${data.instanceId}`);
    });
  }

  get instanceId(): string {
    return this._instanceId;
  }

  get instanceIdAsBigInt(): bigint {
    return BigInt(this._instanceId);
  }

  get cid(): bigint | null {
    return this._cid;
  }

  get isLeader(): boolean {
    return this._isLeader;
  }

  get leaderId(): string | null {
    return this._leaderId;
  }

  getState(): InstanceState {
    return {
      instanceId: this._instanceId,
      cid: this._cid,
      isLeader: this._isLeader,
      leaderId: this._leaderId,
    };
  }

  setCid(cid: bigint | null): void {
    const previousCid: bigint | null = this._cid;
    this._cid = cid;
    this.knownInstances.set(this._instanceId, cid);

    debugLog('InstanceManager', `[InstanceManager] CID changed: ${previousCid?.toString()} -> ${cid?.toString()}`);

    eventEmitter.emit('instance:state-changed', this.getState());

    // Only when it actually changed. Four listeners treat this event as "the
    // session switched" and reset destructively — the permissions cache, the
    // group reconciler, the conversation cache, and the channel's rebroadcast.
    // Five call sites re-set the cid on paths that are not switches (post-auth
    // setup, IO service init, tab-selection sync, orphan selection, connect),
    // and CID is permanent per account, so being handed the cid we already hold
    // is never a switch.
    if (previousCid === cid) {
      return;
    }

    eventEmitter.emit('instance:cid-changed', {
      instanceId: this._instanceId,
      cid: cid,
    });
  }

  setLeader(isLeader: boolean, leaderId: string): void {
    this._isLeader = isLeader;
    this._leaderId = leaderId;

    eventEmitter.emit('instance:state-changed', this.getState());
  }

  registerInstance(instanceId: string, cid: bigint | null): void {
    registry.registerInstance(this.knownInstances, instanceId, cid);
  }

  unregisterInstance(instanceId: string): void {
    registry.unregisterInstance(this.knownInstances, instanceId);
  }

  findInstanceByCid(cid: bigint): string | null {
    return registry.findInstanceByCid(this.knownInstances, cid);
  }

  findInstancesByCid(cid: bigint): string[] {
    return registry.findInstancesByCid(this.knownInstances, cid);
  }

  getAllInstances(): InstanceInfo[] {
    return registry.getAllInstances(this.knownInstances);
  }

  ownsCid(cid: bigint): boolean {
    return this._cid === cid;
  }

  isMessageRelevant(targetInstanceId: string): boolean {
    return targetInstanceId === '*' || targetInstanceId === this._instanceId;
  }

  destroy(): void {
    eventEmitter.emit('instance:disconnected', {
      instanceId: this._instanceId,
    });

    debugLog('InstanceManager', `[InstanceManager] Destroyed instance: ${this._instanceId}`);
  }
}

// Export singleton instance
export const instanceManager: InstanceManager = InstanceManager.getInstance();

// Also export class for testing
export { InstanceManager };
