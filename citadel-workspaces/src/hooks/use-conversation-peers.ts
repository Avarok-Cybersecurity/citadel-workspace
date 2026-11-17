/**
 * useConversationPeers Hook
 *
 * Manages peers with active P2P conversations, sorted by last message time.
 */

import { peerDisplayName, peerHandleName } from '@/lib/peer-display';
import { useState, useEffect, useCallback } from 'react';
import { eventEmitter } from '@/lib/event-emitter';
import { getCurrentCid } from '@/lib/p2p/current-cid';
import { p2pAutoConnectService } from '@/lib/p2p-auto-connect-service';
import { connectionPathFor } from '@/lib/p2p-auto-connect-service/connection-path';
import type { PeerConnectPath } from '@/types/ice-servers';
import { P2PMessengerManager } from '@/lib/p2p';
import { connectionManager } from '@/lib/connection';
import { runAsyncSetup } from '@/lib/utils/async-utils';
import type { RegisteredPeer } from './use-registered-peers';
import type { P2PConversation } from '@/lib/p2p/p2p-types';
import { shownPresence } from '@/lib/presence';

export interface ConversationPeer {
  peerCid: string;
  /** What the peer is addressed by; see peerHandleName. */
  peerUsername: string;
  /** What the peer is shown as. */
  peerDisplayName: string;
  /** True, false, or null when no poll has landed. See lib/presence.ts. */
  isOnline: boolean | null;
  /** True, false, or null when the check did not answer. */
  isConnected: boolean | null;
  /** How the connection travels, when the agent has said. */
  connectionPath: PeerConnectPath | null;
  unreadCount: number;
  lastMessageTime?: number;
}

interface UseConversationPeersProps {
  registeredPeers: RegisteredPeer[];
}

interface UseConversationPeersReturn {
  peersWithConversations: ConversationPeer[];
  /** The first read of the conversations has finished: an empty list before this is "not read yet", not "none". */
  conversationsLoaded: boolean;
  refreshConversations: () => Promise<void>;
}

export function useConversationPeers({
  registeredPeers,
}: UseConversationPeersProps): UseConversationPeersReturn {
  const [peersWithConversations, setPeersWithConversations] = useState<ConversationPeer[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState<boolean>(false);

  const loadConversations: () => Promise<void> = useCallback(async (): Promise<void> => {
    const messenger: P2PMessengerManager = P2PMessengerManager.getInstance();
    const conversations: P2PConversation[] = messenger.getAllConversations();

    // Get current user's CID to filter out self-conversations
    const currentCid: string | undefined = connectionManager.getConnectionInfo()?.cid?.toString();

    // Only include peers with actual messages, excluding self-conversations
    const filteredConversations: P2PConversation[] = conversations
      .filter(c => c.messages.length > 0)
      .filter(c => c.peerCid.toString() !== currentCid);

    // Resolve the session ONCE, and index the peers ONCE.
    //
    // This called `isPeerConnected(peerCid)` per conversation, and that awaits `getCurrentCid()`,
    // which can reach IndexedDB behind a 500ms race — so a person with twenty conversations paid
    // twenty of those, and paid them again on EVERY received message, since this reloads on
    // `p2p:message-received`. The username lookup was a linear `.find` per conversation over
    // every registered peer: O(conversations × peers) on the same path.
    const sessionCid: bigint | null = await getCurrentCid();
    const peerByCid: Map<string, RegisteredPeer> = new Map(
      registeredPeers.map((p: RegisteredPeer) => [p.cid, p]),
    );

    const convPeers: ConversationPeer[] = filteredConversations.map(c => {
      const peerCidStr: string = c.peerCid.toString();
      // Find the username from registered peers
      const registeredPeer: RegisteredPeer | undefined = peerByCid.get(peerCidStr);
      // One module decides how a peer is named. This site hand-rolled its own
      // handle from the LAST six decimal digits, which differs from every other
      // surface, so one peer appeared under two names depending on where you
      // looked.
      const identity: { cid: bigint; username: string | undefined } = { cid: c.peerCid, username: registeredPeer?.username };
      return {
        peerCid: peerCidStr,
        peerUsername: peerHandleName(identity),
        peerDisplayName: peerDisplayName(identity),
        isOnline: shownPresence(registeredPeer?.username, c.peerCid, p2pAutoConnectService.peerOnlineStatus(c.peerCid)),
        // `null` when we cannot name our own session, exactly as isPeerConnected answers:
        // connections are keyed by session, so `false` there answers a question nobody asked.
        isConnected: sessionCid === null ? null : p2pAutoConnectService.isPeerConnectedForSession(sessionCid, c.peerCid),
        connectionPath: connectionPathFor(sessionCid, c.peerCid),
        unreadCount: c.unreadCount,
        lastMessageTime: c.messages[c.messages.length - 1]?.timestamp
      };
    });

    // Sort by most recent message
    convPeers.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));

    setPeersWithConversations(convPeers);
    setConversationsLoaded(true);
  }, [registeredPeers]);

  useEffect(() => {
    runAsyncSetup(loadConversations);

    const handleMessageUpdate = async (): Promise<void> => { await loadConversations(); };

    eventEmitter.on('p2p:message-received', handleMessageUpdate);
    eventEmitter.on('p2p:message-sent', handleMessageUpdate);
    eventEmitter.on('p2p:conversation-updated', handleMessageUpdate);
    // Cached history arrives after the first read. Without this the list stayed
    // "No conversations yet" after every reload, until someone wrote.
    eventEmitter.on('p2p:messages-loaded', handleMessageUpdate);

    return (): void => {
      eventEmitter.off('p2p:message-received', handleMessageUpdate);
      eventEmitter.off('p2p:message-sent', handleMessageUpdate);
      eventEmitter.off('p2p:conversation-updated', handleMessageUpdate);
      eventEmitter.off('p2p:messages-loaded', handleMessageUpdate);
    };
  }, [loadConversations]);

  return {
    peersWithConversations,
    conversationsLoaded,
    refreshConversations: loadConversations,
  };
}
