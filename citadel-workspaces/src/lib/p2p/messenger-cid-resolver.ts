/**
 * Messenger CID Resolver
 *
 * Resolves the current user's CID using multiple fallback strategies.
 * Also provides presence update helpers for peer connect/disconnect.
 */

import { MessagingLayerType } from '@/types/messaging-layer';
import type { PeerPresence } from './p2p-types';
import type { ConversationManager } from './conversation-manager';
import type { PresenceManager } from './presence-manager';
import type { P2PConversation } from '@/lib/p2p/p2p-types';

type EmitFn = (event: string, data: unknown) => void;

/**
 * Who this tab is, for the messenger.
 *
 * A re-export, not an implementation. This file used to carry its own copy of
 * the priority chain -- instance manager, tab selection, tab session, global
 * connection -- with its own 500ms literal where the authority uses
 * `CID_LOOKUP_TIMEOUT_MS`. Two answers to "who am I" in the code that decides
 * which session a message belongs to, and nothing keeping them in step.
 *
 * `p2p-auto-connect-service/cid-resolver.ts` already did it this way.
 */
export { getCurrentCid as resolveCurrentCid } from './current-cid';

/**
 * Update peer presence to Online and broadcast.
 */
export function updatePeerPresenceOnConnect(
  conversationManager: ConversationManager,
  presenceManager: PresenceManager,
  emit: EmitFn,
  peerCid: bigint
): void {
  const conversation: P2PConversation | undefined = conversationManager.getConversation(peerCid);
  if (conversation) {
    const newPresence: PeerPresence = { status: MessagingLayerType.Online as const, lastUpdate: Date.now() };
    conversation.presence = newPresence;
    presenceManager.notifyPresenceChange(peerCid, newPresence);
    emit('p2p:presence-updated', { peerCid: peerCid.toString(), presence: newPresence });
  }
  void presenceManager.broadcastOnlineToNewPeer(peerCid);
}

/**
 * Update peer presence to Offline.
 */
export function updatePeerPresenceOnDisconnect(
  conversationManager: ConversationManager,
  presenceManager: PresenceManager,
  emit: EmitFn,
  peerCid: bigint
): void {
  const conversation: P2PConversation | undefined = conversationManager.getConversation(peerCid);
  if (conversation) {
    const newPresence: PeerPresence = { status: MessagingLayerType.Offline as const, lastUpdate: Date.now() };
    conversation.presence = newPresence;
    presenceManager.notifyPresenceChange(peerCid, newPresence);
    emit('p2p:presence-updated', { peerCid: peerCid.toString(), presence: newPresence });
  }
}
