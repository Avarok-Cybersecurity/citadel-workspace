/**
 * WebSocket Service - Core Class
 *
 * Thin facade that delegates to extracted operation modules.
 */

import type { WorkspaceClient, CompressionHint } from 'citadel-workspace-client-ts';
import { instanceManager } from '../multi-instance/instance-manager';
import { isLeaderSocketUp } from '../multi-instance/agent-socket-state';
// Namespace import to break circular dependency:
// THIS FILE → connection/index.ts → io.ts → io-websocket.ts → websocket-service (cycle)
// Property access on the namespace object is a live binding, deferred to call time.
import * as connModule from '../connection';
import type { SessionSecuritySettings } from '../security-utils';
import type { WebSocketServiceConfig } from './types';
import { resolveWebsocketUrl, readLoopbackAgentOrigin } from './resolve-url';
import { createServiceModules, type ServiceModules } from './module-init';
import { initService, waitForInit as waitForInitFn, resetService } from './initialization';
import { sendRequest as sendRequestFn } from './send-request';
import { heldOutboxOver } from './paused-outbox';
import type { HeldOutbox, ReliableSendOptions } from '@/lib/p2p-pause/outbox';
import type { ChatSecurityLevel } from '@/lib/p2p/chat-advanced-settings';
import type { SendDelivery } from '@/lib/p2p/send-failure';
import type { SignInFactors } from '@/lib/sign-in/types';

export class WebSocketServiceCore {
  client: WorkspaceClient | null = null;
  isInitialized: boolean = false;
  initializationPromise: Promise<void> | null = null;

  private readonly modules: ServiceModules;
  /** The one held outbox. Public for the registration hold (lib/p2p/held-until-registered.ts), which flushes through the normal send. */
  readonly outbox: HeldOutbox = heldOutboxOver(this);

  // Exposed for initialization.ts
  get initOps(): ServiceModules['initOps'] { return this.modules.initOps; }

  constructor(config: WebSocketServiceConfig = {}) {
    // Resolves to a same-origin `/ws` path; resolve-url.ts owns that policy and explains it.
    // `window` is guarded rather than assumed: the guard is defensive (the only construction site
    // is the module-scope singleton in index.ts, and the import cycle above makes this module
    // unimportable in node regardless), and absent a browser the resolver throws by design.
    const wsUrl: string = resolveWebsocketUrl(
      config.websocketUrl,
      import.meta.env.VITE_WS_URL,
      typeof window !== 'undefined' ? window.location : undefined,
      typeof document !== 'undefined' ? readLoopbackAgentOrigin(document) : undefined,
    );

    this.modules = createServiceModules(
      wsUrl,
      config.messageHandler,
      config.errorHandler,
      {
        init: () => this.init(),
        sendRequest: (req, reqId) => this._sendRequest(req, reqId),
        sendMessage: (msg) => this.sendMessage(msg),
        claimSession: (cid, onlyIfOrphaned) => this.claimSession(cid, onlyIfOrphaned),
        disconnect: (cid) => this.disconnect(cid),
        releaseSession: (cid) => this.releaseSession(cid),
        getClient: () => this.client,
        onClientCreated: (client) => { this.client = client; this.isInitialized = true; },
        onClientReset: () => { this.client = null; this.isInitialized = false; this.initializationPromise = null; },
      }
    );
  }

  // ============== Initialization ==============

  async init(): Promise<void> { return initService(this); }
  async waitForInit(): Promise<void> { return waitForInitFn(this); }
  reset(): void { resetService(this); }

  // ============== Core Send ==============

  _sendRequest(request: Record<string, unknown>, requestId?: string): Promise<void> {
    return sendRequestFn(this, request, requestId);
  }

  async sendMessage(message: Record<string, unknown>): Promise<void> {
    await this._sendRequest(message);
  }

  async sendRequest(request: Record<string, unknown>): Promise<void> {
    await this.init();
    return this._sendRequest(request);
  }

  // ============== Auth ==============

  async connect(requestId: string, username: string, serverAddress: string, factors: SignInFactors, sessionSecuritySettings?: SessionSecuritySettings,
  ): Promise<void> { return this.modules.authOps.connect(requestId, username, serverAddress, factors, sessionSecuritySettings) }

  async register(
    requestId: string, username: string, password: string,
    fullName: string, serverAddr: string, admissionToken: string | null, serverPassword?: string,
    sessionSecuritySettings?: SessionSecuritySettings
  ): Promise<void> { return this.modules.authOps.register(requestId, username, password, fullName, serverAddr, admissionToken, serverPassword, sessionSecuritySettings) }

  // ============== Workspace ==============

  async sendWorkspaceRequest(cid: bigint, request: unknown): Promise<void> { return this.modules.workspaceOps.sendWorkspaceRequest(cid, request) }

  // ============== P2P ==============

  // Direct sends have no queue behind them, so a paused contact's are refused.
  async sendP2PMessage(cid: bigint, targetCid: bigint, message: string): Promise<void> { await this.outbox.refuseIfPaused(cid, targetCid); return this.modules.p2pOps.sendP2PMessage(cid, targetCid, message) }

  /**
   * Send a raw `Uint8Array` over the P2P channel without `stringToBytes`-
   * style UTF-8 reinterpretation. Required by callers that already encode
   * payloads as bytes (CBOR via `serializeP2PCommand`) — the string-taking
   * `sendP2PMessage` above would otherwise round-trip the bytes through
   * `stringToBytes` which assumes UTF-8 and corrupts binary payloads.
   */
  async sendP2PMessageBytes(cid: bigint, targetCid: bigint, message: Uint8Array, delivery: SendDelivery): Promise<void> { await this.outbox.refuseIfPaused(cid, targetCid); return this.modules.p2pOps.sendP2PMessageBytes(cid, targetCid, message, delivery) }

  async openP2PConnection(cid: bigint, targetCid: bigint): Promise<void> { return this.modules.p2pOps.openP2PConnection(cid, targetCid) }

  async acceptPeerConnect(cid: bigint, peerCid: bigint, notification: Record<string, unknown> | null): Promise<void> { return this.modules.p2pOps.acceptPeerConnect(cid, peerCid, notification) }
  async declinePeerConnect(cid: bigint, peerCid: bigint, notification: Record<string, unknown> | null): Promise<void> { return this.modules.p2pOps.declinePeerConnect(cid, peerCid, notification) }

  async disconnectP2P(localCid: bigint, peerCid: bigint): Promise<void> { return this.modules.p2pOps.disconnectP2P(localCid, peerCid) }

  // ============== Messenger ==============

  async openMessengerFor(cid: bigint): Promise<void> { return this.modules.messengerOps.openMessengerFor(cid) }

  async ensureMessengerOpen(cid: bigint): Promise<boolean> { return this.modules.messengerOps.ensureMessengerOpen(cid) }

  async sendP2PMessageReliable(
    localCid: bigint, peerCid: bigint, message: Uint8Array,
    securityLevel?: ChatSecurityLevel, compressionHint?: CompressionHint
  ): Promise<void> {
    // The one road into the ILM. A paused contact's messages, edits, reactions
    // and receipts wait in the outbox instead; see p2p-pause/outbox.ts.
    await this.outbox.sendOrHold(localCid, peerCid, message, { securityLevel, compressionHint },
      () => this.modules.messengerOps.sendP2PMessageReliable(localCid, peerCid, message, securityLevel, compressionHint));
  }

  /** Resume's half: hand what the pause held to the ILM, in order, as each would have left at once. */
  async flushPausedOutbox(localCid: bigint, peerCid: bigint): Promise<number> {
    return this.outbox.flush(localCid, peerCid, 'paused',
      (held: Uint8Array, options: ReliableSendOptions) => this.modules.messengerOps.sendP2PMessageReliable(
        localCid, peerCid, held, options.securityLevel, options.compressionHint));
  }

  // ============== Disconnect ==============

  async disconnect(cid: bigint): Promise<void> { return this.modules.disconnectOps.disconnect(cid) }

  async deregister(cid: bigint): Promise<void> { return this.modules.disconnectOps.deregister(cid) }

  async disconnectAndClose(): Promise<void> {
    // Mirrors the disconnection handler in `websocket/initialization.ts`:
    // stop the WASM client's message-processing loop, close the
    // underlying WebSocket, then reset our service state. The previous
    // implementation only nulled the client reference via `resetService`
    // - leaving the WASM-side message loop, the WebSocket, and any P2P
    // polling timers running, which would orphan resources and leak
    // memory if a future caller invoked this method on an active
    // connection (no current callers, but the method's name commits to
    // a full teardown).
    const client: WorkspaceClient | null = this.client;
    if (client) {
      client.stopMessageProcessing();
      try {
        await client.close();
      } catch {
        // Ignore close errors; we proceed to reset local state regardless.
      }
    }
    resetService(this);
  }

  // ============== Session Management ==============

  async setOrphanMode(enabled: boolean): Promise<unknown> { return this.modules.sessionMgmt.setOrphanMode(enabled) }

  setOrphanModeNonBlocking(enabled: boolean): void { this.modules.sessionMgmt.setOrphanModeNonBlocking(enabled) }

  async claimSession(sessionCid: string | bigint, onlyIfOrphaned?: boolean): Promise<unknown> { return this.modules.sessionMgmt.claimSession(sessionCid, onlyIfOrphaned ?? false) }

  async disconnectOrphan(sessionCid?: string | bigint | null): Promise<unknown> { return this.modules.sessionMgmt.disconnectOrphan(sessionCid) }

  releaseSession(sessionCid: bigint): void {
    this.modules.sessionMgmt.releaseSession(sessionCid);
  }

  // ============== State / Getters ==============

  isConnected(): boolean { return this.isInitialized && this.client !== null; }

  /**
   * Whether this tab can get a request to the internal service.
   *
   * NOT the same question as `isConnected`, which asks whether THIS tab owns a
   * WASM client. A follower never owns one — `doInit` sets `client = null` for
   * followers by design — and proxies through the leader instead.
   *
   * Callers that gate a *send* on `isConnected` therefore refuse forever in
   * every follower tab. That is why a second tab in the same browser showed the
   * logged-out landing page with no Active Sessions strip: `fetchActiveSessions`
   * failed this gate and returned `[]` WITHOUT EVER SENDING GetSessions, then
   * cached the empty answer. No amount of retrying could help.
   *
   * `isConnected` is deliberately left alone: its other callers want to know
   * whether a client exists, which is a different and still-valid question.
   */
  canSendRequests(): boolean {
    return this.isInitialized && (this.client !== null || (!instanceManager.isLeader && isLeaderSocketUp()));
  }
  getClient(): WorkspaceClient | null { return this.client; }

  async getWasmModule(): Promise<WorkspaceClient | null> {
    await this.init();
    return this.client ?? null;
  }

  async getWasmClient(): Promise<WorkspaceClient | null> {
    await this.init();
    return this.client;
  }

  async getConnectionInfo(): Promise<{ cid: bigint } | null> {
    return connModule.connectionManager.getConnectionInfo();
  }

  // ============== LocalDB ==============

  async sendLocalDBGet(cid: bigint, key: string): Promise<{ value: number[] } | null> {
    return this.modules.localDB.get(cid, key);
  }

  async sendLocalDBSet(cid: bigint, key: string, value: number[]): Promise<void> { return this.modules.localDB.set(cid, key, value) }

  async sendLocalDBDelete(cid: bigint, key: string): Promise<void> { return this.modules.localDB.delete(cid, key) }

  async sendLocalDBListKeys(cid: bigint, prefix?: string): Promise<string[]> { return this.modules.localDB.listKeys(cid, prefix) }

  // ============== File Picker ==============

  async pickFile(
    cid: bigint, title?: string, allowedExtensions?: string[]
  ): Promise<{ file_path: string; file_name: string; file_size: bigint }> {
    return this.modules.filePicker.pickFile(cid, title, allowedExtensions);
  }
}
