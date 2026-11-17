/**
 * A peer's screenshot notice, written into the conversation as a system line.
 *
 * Stored like any inbound message (so it survives a reload and is in the
 * transcript), but as `message_type: 'system_notice'`, which renders as a line
 * across the thread rather than a bubble. Only written when the RECEIVING user
 * asked to be told; the sender cannot know that, so it always sends.
 */
import type { P2PMessagingLayerPayload } from '@/types/p2p-types';
import type { MessageHandlerConfig } from './message-handler-types';
import type { P2PMessage } from './p2p-types';

export interface ScreenshotNoticeContext {
  /** The receiving user's own `notifyOnScreenshot`. */
  notify: boolean;
  peerName: string;
}

export function screenshotNoticeText(peerName: string): string {
  return `${peerName} may have taken a screenshot`;
}

export async function applyScreenshotNotice(
  config: MessageHandlerConfig,
  payload: P2PMessagingLayerPayload,
  peerCid: bigint,
  context: ScreenshotNoticeContext,
): Promise<void> {
  if (!context.notify) return;
  const takenAt: unknown = (payload.layer as { taken_at?: unknown }).taken_at;
  const message: P2PMessage = {
    id: payload.message_id,
    content: screenshotNoticeText(context.peerName),
    senderCid: peerCid,
    recipientCid: BigInt(payload.recipient_cid),
    timestamp: typeof takenAt === 'number' ? takenAt : Date.now(),
    index: payload.index,
    status: 'delivered',
    message_type: 'system_notice',
  };
  if (await config.addMessageToConversation(peerCid, message)) {
    config.notifyMessageListeners(message);
  }
}
