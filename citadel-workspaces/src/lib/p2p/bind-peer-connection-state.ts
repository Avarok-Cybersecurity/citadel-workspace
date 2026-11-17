/**
 * The two halves of a peer's connection state, kept in one place.
 *
 * `p2p-connection-established` and `p2p-connection-lost` each touch four things
 * — the conversation's connection flag, the external connection listeners, the
 * check-state manager's readiness, and presence — and the pair only stays
 * correct while both halves touch the same four. Split across the manager's
 * event-wiring block they read as two unrelated handlers, which is the shape
 * that lets one side gain a step the other never gets.
 */
import type { ConversationManager } from './conversation-manager';
import { updatePeerPresenceOnConnect, updatePeerPresenceOnDisconnect } from './messenger-cid-resolver';

interface PeerConnectionDeps {
  conversationManager: ConversationManager;
  presenceManager: Parameters<typeof updatePeerPresenceOnConnect>[1];
  emit: (event: string, data?: unknown) => void;
  notifyListeners: (peerCid: bigint, connected: boolean) => void;
  markReady: (peerCid: bigint) => void;
  clearReady: (peerCid: bigint) => void;
}

export function bindPeerConnectionState(
  listen: <T>(event: string, handler: (data: T) => void) => void,
  deps: PeerConnectionDeps,
): void {
  const apply = (peerCid: bigint, connected: boolean): void => {
    deps.conversationManager.setConnection(peerCid, connected);
    deps.notifyListeners(peerCid, connected);
    if (connected) {
      deps.markReady(peerCid);
      updatePeerPresenceOnConnect(deps.conversationManager, deps.presenceManager, deps.emit, peerCid);
    } else {
      deps.clearReady(peerCid);
      updatePeerPresenceOnDisconnect(deps.conversationManager, deps.presenceManager, deps.emit, peerCid);
    }
  };

  listen<{ peerCid: bigint }>('p2p-connection-established', ({ peerCid }) => apply(peerCid, true));
  listen<{ peerCid: bigint }>('p2p-connection-lost', ({ peerCid }) => apply(peerCid, false));
}
