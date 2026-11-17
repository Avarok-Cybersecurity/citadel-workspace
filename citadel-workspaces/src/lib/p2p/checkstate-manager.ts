/**
 * CheckState Manager
 *
 * Handles the CheckState/CheckStateResponse handshake protocol.
 * This is an optional optimization - the ILM (Intersession Layer Manager)
 * handles message reliability, so CheckState is primarily for confirming
 * peer readiness before sending the first message.
 */

import {
  createMessagingLayerCommand,
  serializeP2PCommand,
} from '@/types/p2p-types';
import {
  createCheckState,
  createCheckStateResponse,
} from '@/types/messaging-layer';
import { debugLog } from '@/lib/debug-config';
import type { MessagingLayer } from '@/types/messaging-layer';
import type { P2PCommand } from '@/types/p2p-commands';
import type { CompressionHint } from 'citadel-workspace-client-ts';
import { compressionHintFor } from './compression-hints';

export interface CheckStateConfig {
  /** Timeout for CheckState response (ms) */
  timeout: number;
  /** Function to send serialized bytes to peer */
  sendToP2P: (peerCid: bigint, bytes: Uint8Array, compressionHint: CompressionHint | undefined) => Promise<void>;
  /** Function to get current CID */
  getCurrentCid: () => Promise<bigint | null>;
  /** Function to get conversation's last message index */
  getLastMessageIndex: (peerCid: bigint) => number;
}

export class CheckStateManager {
  // Peer ready state tracking for CheckState/CheckStateResponse handshake
  private peerReadyState: Map<bigint, boolean> = new Map();
  private pendingCheckStates: Map<bigint, { resolve: () => void; reject: (e: Error) => void }> = new Map();

  /**
   * Handshakes in progress, so concurrent callers share one.
   *
   * `pendingCheckStates` is keyed by peer alone, so a second call overwrote the
   * first's `{resolve, reject}` and the timeout checked "is there ANY entry",
   * not "is mine still there" — leaving one promise permanently unsettled.
   * message-sender awaits this before persisting, so the composer cleared and
   * the message never appeared, was never stored, and raised no error.
   */
  private inFlightChecks: Map<bigint, Promise<void>> = new Map();

  // Queue for pending CheckState responses when tab is hidden
  private pendingCheckStateResponses: bigint[] = [];

  private readonly config: CheckStateConfig;

  constructor(config: CheckStateConfig) {
    this.config = config;
  }

  /**
   * Check if a peer is marked as ready (has passed CheckState handshake)
   */
  public isPeerReady(peerCid: bigint): boolean {
    return this.peerReadyState.get(peerCid) || false;
  }

  /**
   * Mark a peer as ready (e.g., on connection established or message received)
   */
  public markPeerReady(peerCid: bigint): void {
    if (!this.peerReadyState.get(peerCid)) {
      this.peerReadyState.set(peerCid, true);
      debugLog('CheckstateManager', `[P2P] Marked peer ${peerCid.toString().slice(0, 8)}... as ready`);
    }
  }

  /**
   * Clear ready state for a peer (e.g., when they disconnect)
   */
  public clearPeerReadyState(peerCid: bigint): void {
    this.peerReadyState.delete(peerCid);
    const pending: { resolve: () => void; reject: (e: Error) => void; } | undefined = this.pendingCheckStates.get(peerCid);
    if (pending) {
      pending.reject(new Error('Peer disconnected'));
      this.pendingCheckStates.delete(peerCid);
    }
  }

  /**
   * Handle received CheckStateResponse - resolve pending promise
   */
  public handleCheckStateResponse(peerCid: bigint): void {
    debugLog('CheckstateManager', '[P2P] Received CheckStateResponse from peer:', peerCid);
    this.peerReadyState.set(peerCid, true);
    const pending: { resolve: () => void; reject: (e: Error) => void; } | undefined = this.pendingCheckStates.get(peerCid);
    if (pending) {
      pending.resolve();
      this.pendingCheckStates.delete(peerCid);
    }
  }

  /**
   * Handle received CheckState - send CheckStateResponse
   */
  public async handleCheckState(peerCid: bigint): Promise<void> {
    debugLog('CheckstateManager', '[P2P] Received CheckState from peer:', peerCid, '- responding Ready');

    // Queue for flush when tab becomes visible (handles browser throttling in background tabs)
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.pendingCheckStateResponses.push(peerCid);
      debugLog('CheckstateManager', `[P2P] Tab hidden - queued CheckState response for ${peerCid}`);
    }
    // Always try to respond immediately (best effort - may be throttled in background)
    await this.sendCheckStateResponse(peerCid);
  }

  /**
   * Send CheckStateResponse to a peer
   */
  public async sendCheckStateResponse(peerCid: bigint): Promise<void> {
    const currentCid: bigint | null = await this.config.getCurrentCid();
    if (!currentCid) return;

    const response: MessagingLayer = createCheckStateResponse();
    const command: P2PCommand = createMessagingLayerCommand(
      response,
      currentCid,
      peerCid,
      this.config.getLastMessageIndex(peerCid)
    );

    try {
      const bytes: Uint8Array<ArrayBufferLike> = serializeP2PCommand(command);
      await this.config.sendToP2P(peerCid, bytes, compressionHintFor(command));
      debugLog('CheckstateManager', '[P2P] Sent CheckStateResponse to peer:', peerCid);
    } catch (error) {
      debugLog('CheckstateManager', 'Failed to send CheckStateResponse:', error);
    }
  }

  /**
   * Ensure peer is ready for messaging by sending CheckState and waiting for response.
   * Must be called before sending any message to a peer.
   *
   * @param peerCid - The peer's CID to verify
   * @throws Error if peer doesn't respond within timeout
   */
  public async ensurePeerReady(peerCid: bigint): Promise<void> {
    // If already confirmed ready, skip handshake
    if (this.peerReadyState.get(peerCid)) {
      debugLog('CheckstateManager', '[P2P] Peer already marked as ready:', peerCid);
      return;
    }

    // Share a handshake already under way rather than starting a second one.
    const existing: Promise<void> | undefined = this.inFlightChecks.get(peerCid);
    if (existing) {
      debugLog('CheckstateManager', '[P2P] Joining in-flight CheckState for peer:', peerCid);
      return existing;
    }

    const handshake: Promise<void> = this.runCheckState(peerCid);
    this.inFlightChecks.set(peerCid, handshake);
    try {
      return await handshake;
    } finally {
      this.inFlightChecks.delete(peerCid);
    }
  }

  /** The handshake itself. Only ever one per peer at a time; see ensurePeerReady. */
  private async runCheckState(peerCid: bigint): Promise<void> {
    debugLog('CheckstateManager', '[P2P] Initiating CheckState handshake with peer:', peerCid);

    const currentCid: bigint | null = await this.config.getCurrentCid();
    if (!currentCid) {
      throw new Error('Not connected to server');
    }

    // Create CheckState command
    const checkState: MessagingLayer = createCheckState();
    const command: P2PCommand = createMessagingLayerCommand(
      checkState,
      currentCid,
      peerCid,
      this.config.getLastMessageIndex(peerCid)
    );

    // Create promise that resolves when CheckStateResponse received
    const readyPromise: Promise<void> = new Promise<void>((resolve, reject) => {
      this.pendingCheckStates.set(peerCid, { resolve, reject });

      // Timeout handling
      setTimeout(() => {
        if (this.pendingCheckStates.has(peerCid)) {
          this.pendingCheckStates.delete(peerCid);
          reject(new Error(`Peer ${peerCid} did not respond to CheckState within ${this.config.timeout}ms`));
        }
      }, this.config.timeout);
    });

    // Send the CheckState request
    try {
      const bytes: Uint8Array<ArrayBufferLike> = serializeP2PCommand(command);
      await this.config.sendToP2P(peerCid, bytes, compressionHintFor(command));
      debugLog('CheckstateManager', '[P2P] Sent CheckState to peer:', peerCid);
    } catch (error) {
      // Clean up pending state on send failure
      this.pendingCheckStates.delete(peerCid);
      throw error;
    }

    // Wait for response
    await readyPromise;
    debugLog('CheckstateManager', '[P2P] Peer confirmed ready:', peerCid);
  }

  /**
   * Try to ensure peer is ready, but don't fail if CheckState times out.
   * Returns true if peer confirmed ready, false if timeout (proceed anyway).
   * The intersession layer manager in WASM handles reliability, so CheckState is optional.
   */
  public async tryEnsurePeerReady(peerCid: bigint): Promise<boolean> {
    try {
      await this.ensurePeerReady(peerCid);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('did not respond to CheckState')) {
        debugLog('CheckstateManager', `[P2P] CheckState timeout for ${peerCid}, proceeding with send anyway (transport layer handles reliability)`);
        return false;
      }
      throw error;  // Re-throw other errors
    }
  }

  /**
   * Flush any pending CheckState responses that were queued while tab was hidden.
   */
  public flushPendingCheckStateResponses(): void {
    if (this.pendingCheckStateResponses.length === 0) return;

    debugLog('CheckstateManager', `[P2P] Flushing ${this.pendingCheckStateResponses.length} pending CheckState responses`);
    for (const peerCid of this.pendingCheckStateResponses) {
      this.sendCheckStateResponse(peerCid).catch(error => {
        debugLog('CheckstateManager', '[P2P] Failed to send queued CheckStateResponse:', error);
      });
    }
    this.pendingCheckStateResponses = [];
  }
}
