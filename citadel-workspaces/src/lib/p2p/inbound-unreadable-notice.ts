/**
 * A message that arrived and could not be read, written into its conversation
 * as a system line (the same `system_notice` the screenshot notice uses).
 *
 * It used to be a debug line: the peer had sent something, the recipient never
 * saw it or any sign it existed, and neither side could know.
 */
import type { MessageHandlerConfig } from './message-handler-types';
import { peerDisplayName } from '@/lib/peer-display';
import { p2pRegistrationService } from '../p2p-registration-service';
import type { P2PMessage } from './p2p-types';

export function unreadableNoticeText(peerName: string): string {
  return `A message from ${peerName} couldn't be read`;
}

export async function noteUnreadableMessage(
  config: MessageHandlerConfig,
  peerCid: bigint,
): Promise<void> {
  await noteFromPeer(config, peerCid, unreadableNoticeText);
}

/** Writes `text(peer's name)` into the conversation with `peerCid` as a system line. */
export async function noteFromPeer(config: MessageHandlerConfig, peerCid: bigint, text: (peerName: string) => string): Promise<void> {
  const peerName: string = peerDisplayName(p2pRegistrationService.getPeerInfo(peerCid) ?? { cid: peerCid });
  const ownCid: bigint | null = await config.getCurrentCid();
  if (ownCid === null) return;
  const message: P2PMessage = {
    id: crypto.randomUUID(),
    content: text(peerName),
    senderCid: peerCid,
    recipientCid: ownCid,
    timestamp: Date.now(),
    index: 0,
    status: 'delivered',
    message_type: 'system_notice',
  };
  if (await config.addMessageToConversation(peerCid, message)) config.notifyMessageListeners(message);
}
