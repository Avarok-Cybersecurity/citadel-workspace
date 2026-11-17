/**
 * The registration hold (held-until-registered.ts), wired to the real outbox, registry and send.
 */
import { websocketService } from '../websocket-service';
import { p2pRegistrationService } from '../p2p-registration-service';
import { withSerialLock } from '@/lib/serial-queue';
import { debugLog } from '@/lib/debug-config';
import { sendAllowingForAConcurrentOpen } from './message-send-operations';
import { persistMessageStatus } from './message-status-persistence';
import { statusAdvances } from './message-status';
import type { MessageSenderConfig } from './message-sender-types';
import type { P2PMessage } from './p2p-types';
import type { RegistrationHoldDeps } from './held-until-registered';
import type { HeldOutbox } from '@/lib/p2p-pause/outbox';
import type { CompressionHint } from 'citadel-workspace-client-ts';

/**
 * Across tabs with the Web Locks API, so two tabs of one session cannot both send a held
 * message. Where a browser lacks it, the lock is this tab's alone: still exactly once per tab.
 */
async function exclusive(name: string, task: () => Promise<number>): Promise<number> {
  const locks: LockManager | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks === undefined) return withSerialLock(name, task);
  return await locks.request(name, task); // held until the task settles
}

/** Never throws, as the hold requires: persistMessageStatus does not, and the rest is memory. */
async function markSent(config: MessageSenderConfig, peerCid: bigint, messageId: string): Promise<void> {
  const inMemory: P2PMessage | undefined = config.getOrCreateConversation(peerCid).messages.find((m: P2PMessage): boolean => m.id === messageId);
  const message: P2PMessage | null = inMemory ?? await config.findStoredMessage(peerCid, messageId).catch((error: unknown): null => {
    // Sent regardless; only the tick lags, until the peer's receipt advances it.
    debugLog('RegistrationHold', `Sent held message ${messageId} but could not read it back to mark it`, error);
    return null;
  });
  if (message === null || !statusAdvances(message.status, 'sent')) return;
  message.status = 'sent';
  config.notifyMessageStatusListeners(messageId, 'sent');
  await persistMessageStatus(config, peerCid, messageId, message);
}

export function registrationHoldFor(config: MessageSenderConfig): RegistrationHoldDeps {
  return {
    // Each read at call time, not here: the sender is built while the service is still being imported.
    outbox: {
      hold: (...args: Parameters<HeldOutbox['hold']>): Promise<void> => websocketService.outbox.hold(...args),
      flush: (...args: Parameters<HeldOutbox['flush']>): Promise<number> => websocketService.outbox.flush(...args),
    },
    isRegistered: (peerCid: bigint): boolean => p2pRegistrationService.isPeerRegistered(peerCid),
    send: (localCid: bigint, peerCid: bigint, bytes: Uint8Array, hint: CompressionHint | undefined): Promise<void> =>
      sendAllowingForAConcurrentOpen(localCid, peerCid, bytes, hint),
    markSent: (peerCid: bigint, messageId: string): Promise<void> => markSent(config, peerCid, messageId),
    exclusive,
  };
}
