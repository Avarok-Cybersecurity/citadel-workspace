/**
 * Put a message into the one state the UI can act on.
 *
 * `failed` is not just a label: the retry affordance is gated on it
 * (`useP2PMessages` ignores a retry for anything else), and it is persisted
 * before any rethrow so retryability survives a reload. Two places in the send
 * path need exactly this — a storage failure before transmission, and a
 * transmission failure — and they had drifted into near-copies.
 */
import type { P2PMessage } from './p2p-types';

export interface FailureNotifier {
  notifyMessageListeners: (message: P2PMessage) => void;
  notifyMessageStatusListeners: (messageId: string, status: P2PMessage['status']) => void;
}

export function markSendFailed(
  config: FailureNotifier,
  message: P2PMessage,
  messageId: string,
  error: unknown,
  fallbackReason: string,
): void {
  message.status = 'failed';
  message.error = error instanceof Error ? error.message : fallbackReason;
  config.notifyMessageListeners(message);
  config.notifyMessageStatusListeners(messageId, 'failed');
}
