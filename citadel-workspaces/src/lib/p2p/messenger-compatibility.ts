/**
 * Messenger Compatibility Methods
 *
 * Backend sync, peer registration and file transfer state
 * operations extracted from P2PMessengerManager for modularity.
 */

import { wireMapEntries } from '@/lib/wire-map';
import { connectionManager } from '../connection';
import { p2pAutoConnectService } from '../p2p-auto-connect-service';
import { sendPeerRegistration } from './send-peer-registration';
import type { ConversationManager } from './conversation-manager';
import type { P2PMessage } from './p2p-types';
import { debugLog } from '@/lib/debug-config';
import type { P2PConversation } from '@/lib/p2p/p2p-types';
import type { SessionInformation } from 'citadel-workspace-client-ts';

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
    const activeSessions: SessionInformation[] = await connectionManager.getActiveSessions();
    const currentCid: bigint | null = await getCurrentCid();
    if (!currentCid) return;
    const mySession: SessionInformation | undefined = activeSessions.find(s => s.cid === currentCid);
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
