/**
 * Outbound Queue
 *
 * Manages in-memory queue of messages pending ACK from the leader.
 * Provides timeout-based retry logic and max retry handling.
 *
 * Flow:
 * 1. Instance calls enqueue(payload) -> returns requestId
 * 2. Message sent to leader via InstanceChannel
 * 3. Leader processes and sends ACK { status: 'processed' | 'error', error?: string }
 * 4. Instance calls acknowledge(requestId, status) -> removes from queue
 *
 * Timeout/Retry:
 * - If no ACK within ACK_TIMEOUT_MS, message is retried
 * - Max MAX_RETRIES attempts
 * - After max retries, emits 'outbound-failed' event
 */

import { eventEmitter } from '../event-emitter';
import { instanceManager } from './instance-manager';
import { PollingService } from '../utils/polling-service';
import { debugLog } from '@/lib/debug-config';
import { TIMEOUT } from '../timeout-constants';
import type { QueuedMessage, AckResult } from './outbound-queue-types';

export type { QueuedMessage, AckResult, ProxyResponseData } from './outbound-queue-types';
export { isEnsureMessengerOpenResponse } from './outbound-queue-types';

// Deliberately shorter than sendToLeader's 30s: this deadline also bounds
// giving up, so matching it turns a dead leader into a 90s hang. Duplicate
// execution is prevented at the leader (inFlight). ROBUSTNESS round 153.
const ACK_TIMEOUT_MS: number = TIMEOUT.SERVER_REQUEST_MS;
const MAX_RETRIES: number = 3;
const CHECK_INTERVAL_MS: number = 1000;

class OutboundQueue extends PollingService {
  private static instance: OutboundQueue;
  private queue: Map<string, QueuedMessage> = new Map();

  private constructor() {
    super();
    this.setupEventListeners();
  }

  public static getInstance(): OutboundQueue {
    if (!OutboundQueue.instance) {
      OutboundQueue.instance = new OutboundQueue();
    }
    return OutboundQueue.instance;
  }

  protected getPollingIntervalMs(): number {
    return CHECK_INTERVAL_MS;
  }

  protected async poll(): Promise<void> {
    this.checkTimeouts();
  }

  private setupEventListeners(): void {
    eventEmitter.on('instance:leader-changed', (data: { isLeader: boolean; leaderId: string }) => {
      if (data.leaderId) {
        this.onLeaderChange(data.leaderId);
      }
    });
  }

  /** Nothing to time out means nothing to poll for. */
  private stopIfIdle(): void {
    if (this.queue.size === 0 && this.isPolling) this.stopPolling();
  }

  /**
   * Arm the timeout checker. The Timeout/Retry contract at the top of this file
   * does not happen without it — and it had no caller anywhere in production,
   * so `handleTimeout`, `MAX_RETRIES` and `outbound-failed` were unreachable
   * code behind a written promise. `enqueue` arms it now, so it cannot be
   * forgotten again.
   */
  start(): void {
    if (this.isPolling) return;
    this.startPolling();
    debugLog('OutboundQueue', '[OutboundQueue] Started timeout checker');
  }

  stop(): void {
    this.stopPolling();
    debugLog('OutboundQueue', '[OutboundQueue] Stopped timeout checker');
  }

  enqueue(payload: unknown, requestId?: string): string {
    const id: string = requestId || crypto.randomUUID();

    const message: QueuedMessage = {
      requestId: id,
      payload,
      instanceId: instanceManager.instanceId,
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.queue.set(id, message);
    // Self-arming — see `start()`.
    if (!this.isPolling) this.start();
    debugLog('OutboundQueue', `[OutboundQueue] Enqueued message: ${id} (queue size: ${this.queue.size})`);

    return id;
  }

  acknowledge(requestId: string, result: AckResult): void {
    const message: QueuedMessage | undefined = this.queue.get(requestId);

    if (!message) {
      debugLog('OutboundQueue', `[OutboundQueue] ACK for unknown requestId: ${requestId}`);
      return;
    }

    if (message.timeoutId) {
      clearTimeout(message.timeoutId);
    }

    this.queue.delete(requestId);
    this.stopIfIdle();

    const latency: number = Date.now() - message.timestamp;
    debugLog('OutboundQueue', `[OutboundQueue] ACK received: ${requestId} (status: ${result.status}, latency: ${latency}ms)`);

    if (result.status === 'error') {
      debugLog('OutboundQueue', `Message failed: ${requestId}`, result.error);
      eventEmitter.emit('outbound-error', {
        requestId,
        error: result.error,
        payload: message.payload,
      });
    }
  }

  get(requestId: string): QueuedMessage | undefined {
    return this.queue.get(requestId);
  }

  remove(requestId: string): void {
    const message: QueuedMessage | undefined = this.queue.get(requestId);
    if (message?.timeoutId) {
      clearTimeout(message.timeoutId);
    }
    this.queue.delete(requestId);
    this.stopIfIdle();
  }

  getPending(): QueuedMessage[] {
    return Array.from(this.queue.values());
  }

  getTimedOut(): QueuedMessage[] {
    const now: number = Date.now();
    return Array.from(this.queue.values()).filter(
      (msg) => now - msg.timestamp > ACK_TIMEOUT_MS
    );
  }

  private checkTimeouts(): void {
    const now: number = Date.now();

    for (const [requestId, message] of this.queue) {
      const elapsed: number = now - message.timestamp;

      if (elapsed > ACK_TIMEOUT_MS) {
        this.handleTimeout(requestId, message);
      }
    }
  }

  private handleTimeout(requestId: string, message: QueuedMessage): void {
    if (message.retryCount >= MAX_RETRIES) {
      debugLog('OutboundQueue', `Max retries exceeded for ${requestId}, giving up`);

      this.queue.delete(requestId);
    this.stopIfIdle();

      eventEmitter.emit('outbound-failed', {
        requestId,
        error: `Max retries (${MAX_RETRIES}) exceeded`,
        payload: message.payload,
      });

      return;
    }

    message.retryCount++;
    message.timestamp = Date.now();

    debugLog('OutboundQueue', `[OutboundQueue] Retrying ${requestId} (attempt ${message.retryCount}/${MAX_RETRIES})`);

    eventEmitter.emit('outbound-retry', {
      requestId,
      payload: message.payload,
      retryCount: message.retryCount,
    });
  }

  onLeaderChange(newLeaderId: string): void {
    if (this.queue.size === 0) return;

    debugLog('OutboundQueue', `[OutboundQueue] Leader changed to ${newLeaderId}, retrying ${this.queue.size} pending messages`);

    for (const [requestId, message] of this.queue) {
      message.timestamp = Date.now();

      eventEmitter.emit('outbound-retry', {
        requestId,
        payload: message.payload,
        retryCount: message.retryCount,
        reason: 'leader-change',
      });
    }
  }

  getStats(): { size: number; oldestMs: number | null } {
    const now: number = Date.now();
    let oldestMs: number | null = null;

    for (const message of this.queue.values()) {
      const age: number = now - message.timestamp;
      if (oldestMs === null || age > oldestMs) {
        oldestMs = age;
      }
    }

    return { size: this.queue.size, oldestMs };
  }

  clear(): void {
    for (const message of this.queue.values()) {
      if (message.timeoutId) {
        clearTimeout(message.timeoutId);
      }
    }
    this.queue.clear();
    debugLog('OutboundQueue', '[OutboundQueue] Cleared all pending messages');
  }

  destroy(): void {
    this.stop();
    this.clear();
  }
}

export const outboundQueue: OutboundQueue = OutboundQueue.getInstance();
export { OutboundQueue };
