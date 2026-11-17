/**
 * Messenger Compatibility Methods
 *
 * Backend sync, peer registration, file transfer state, and read tracking
 * operations extracted from P2PMessengerManager for modularity.
 */

import { wireMapEntries } from '@/lib/wire-map';
import { connectionManager } from '../connection';
import { p2pAutoConnectService } from '../p2p-auto-connect-service';
import { sendPeerRegistration } from './send-peer-registration';
import { messagePaginationStore } from './message-pagination-store';
import type { ConversationManager } from './conversation-manager';
import type { P2PMessage } from './p2p-types';
import { debugLog } from '@/lib/debug-config';
import { getPrivacySettings } from '@/lib/privacy-settings';
import type { P2PConversation } from '@/lib/p2p/p2p-types';
import type { ActiveSession } from '@/types/session-types';

type EmitFn = (event: string, data: unknown) => void;

/**
 * Sync P2P connections from backend session state.
 */
export async function syncConnectionsFromBackend(
  conversationManager: ConversationManager,
  getCurrentCid: () => Promise<bigint | null>,
  onConnect: (peerCid: bigint) => void
): Promise<void> {
  try {
    const activeSessions: ActiveSession[] = await connectionManager.getActiveSessions();
    const currentCid: bigint | null = await getCurrentCid();
    if (!currentCid) return;
    const mySession: ActiveSession | undefined = activeSessions.find(s => s.cid === currentCid);
    // A third site reading the wire HashMap as an object, and the one that
    // decides which conversations are marked connected -- so after a reconnect
    // every conversation stayed grey until something else noticed.
    for (const [peerCidStr] of wireMapEntries<unknown>(
      mySession?.peer_connections,
      'peer_connections',
    )) {
      const peerCid: bigint = BigInt(peerCidStr);
      if (!conversationManager.isConnected(peerCid)) {
        conversationManager.setConnection(peerCid, true);
        onConnect(peerCid);
      }
    }
    for (const peerCid of await p2pAutoConnectService.getConnectedPeers()) {
      if (!conversationManager.isConnected(peerCid)) {
        conversationManager.setConnection(peerCid, true);
        onConnect(peerCid);
      }
    }
  } catch (error) {
    debugLog('MessengerCompatibility', 'syncConnectionsFromBackend: Failed to sync connections:', error);
  }
}

/**
 * Update file transfer state for a message in a conversation.
 */
export function updateFileTransferState(
  conversationManager: ConversationManager,
  emit: EmitFn,
  peerCid: bigint,
  transferId: string,
  updates: { transfer_state?: P2PMessage['transfer_state']; transfer_progress?: number }
): void {
  const conversation: P2PConversation | undefined = conversationManager.getConversation(peerCid);
  if (!conversation) return;
  const message: P2PMessage | undefined = conversation.messages.find(m => m.transfer_id === transferId);
  if (!message) return;
  if (updates.transfer_state !== undefined) message.transfer_state = updates.transfer_state;
  if (updates.transfer_progress !== undefined) message.transfer_progress = updates.transfer_progress;
  emit('p2p:message-updated', message);
}

/**
 * Mark messages as read and send acknowledgments.
 */
export async function markMessagesAsRead(
  conversationManager: ConversationManager,
  sendMessageAck: (messageId: string, ackType: 'delivered' | 'read' | 'failed', peerCid: bigint) => Promise<void>,
  emit: EmitFn,
  peerCid: bigint,
  messageIds?: string[]
): Promise<void> {
  const conversation: P2PConversation | undefined = conversationManager.getConversation(peerCid);
  if (!conversation) return;

  // `conversation.messages` is EMPTY after a reload — loadFromStorage restores it
  // as [] and nothing rehydrates it — while the transcript on screen was
  // rendered from the page store. So this filtered an empty array: zero read
  // receipts were sent for messages the user had visibly just read, and the
  // unread count computed from the same empty array came out 0 and was
  // persisted. The badge cleared without the receipts that justify it, and the
  // sender's bubbles stayed on 'delivered' for ever.
  let messagesToMark: P2PMessage[] = messageIds
    ? conversation.messages.filter(m => messageIds.includes(m.id))
    : conversation.messages.filter(m => m.senderCid === peerCid && m.status === 'delivered');

  if (messagesToMark.length === 0 && !messageIds) {
    messagesToMark = await messagePaginationStore.findUnreadFromPeer(peerCid);
  }

  // The LOCAL side of "read" always happens: the user did read these, so the
  // unread badge must clear and the transcript must reflect it. Only the ack —
  // the part that tells the sender — is the user's to withhold.
  const sendReceipts: boolean = getPrivacySettings().sendReadReceipts;

  // Mark everything locally FIRST, then send the acks.
  //
  // The ack used to be awaited inside this loop, which made the local marking
  // depend on it in both of the ways that matter. One failing ack -- a peer
  // that has gone away, a socket mid-reconnect -- threw out of the loop, and
  // every message after it stayed `delivered`: unread badge intact, transcript
  // wrong, for messages the user demonstrably read. That directly contradicts
  // the comment three lines above, which says the local side ALWAYS happens.
  //
  // And it serialised the sends. Opening a conversation with 200 unread meant
  // 200 sequential P2P round trips before this function returned, with the
  // unread count updating only at the end.
  const markedMessageIds: string[] = [];
  for (const message of messagesToMark) {
    if (message.status === 'delivered') {
      message.status = 'read';
      markedMessageIds.push(message.id);
    }
  }

  if (sendReceipts && markedMessageIds.length > 0) {
    // allSettled, not all: one unreachable peer must not reject this call, and
    // must not undo the marking above. A read receipt is advisory -- the sender
    // learns later, or does not.
    const outcomes: PromiseSettledResult<void>[] = await Promise.allSettled(
      markedMessageIds.map((id) => sendMessageAck(id, 'read', peerCid)),
    );
    const failed: number = outcomes.filter((o) => o.status === 'rejected').length;
    if (failed > 0) {
      debugLog('P2P', `${failed}/${outcomes.length} read receipts could not be sent to ${peerCid}`);
    }
  }

  // Derived from what was actually marked when memory is empty, rather than
  // from the empty array — which reported 0 unread whatever the truth was.
  const remainingInMemory: number = conversation.messages.filter(
    m => m.senderCid === peerCid && m.status === 'delivered',
  ).length;
  const newUnreadCount: number = conversation.messages.length === 0
    ? Math.max(0, conversation.unreadCount - markedMessageIds.length)
    : remainingInMemory;
  conversation.unreadCount = newUnreadCount;

  await Promise.all([
    ...markedMessageIds.map(msgId => messagePaginationStore.updateMessageInPages(peerCid, msgId, { status: 'read' })),
    messagePaginationStore.updateUnreadCount(peerCid, newUnreadCount)
  ]);

  // Prefixed 'p2p:' like every other event on this emitter. Without the prefix
  // this had no subscriber at all, so the sidebar's unread badge kept showing
  // a count the conversation no longer had.
  emit('p2p:conversation-updated', { peerCid, conversation });
}

/**
 * Update unread count for a peer conversation.
 */
export async function updateUnreadCount(
  conversationManager: ConversationManager,
  peerCid: bigint,
  unreadCount: number
): Promise<void> {
  const conversation: P2PConversation | undefined = conversationManager.getConversation(peerCid);
  if (conversation) conversation.unreadCount = unreadCount;
  await messagePaginationStore.updateUnreadCount(peerCid, unreadCount);
}

/**
 * Ask a peer to connect, from the Messages page's Available list.
 *
 * The same request the discovery modal and the directory send: recorded, so it
 * is resent and the peer's answer is recognised as theirs to ours. It had its
 * own copy, which recorded nothing, sent string CIDs, and announced the peer as
 * registered before they had answered (a-click-request-is-a-real-request.test.ts).
 */
export async function autoRegisterPeer(
  getCurrentCid: () => Promise<bigint | null>,
  peerCid: bigint,
  peerUsername: string
): Promise<void> {
  const ownCid: bigint | null = await getCurrentCid();
  if (!ownCid) throw new Error('No CID provided for registration');
  await sendPeerRegistration(ownCid, peerCid, peerUsername);
}
