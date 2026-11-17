/**
 * What a conversation's presence should say the moment it is created.
 *
 * `getOrCreateConversation` is synchronous, and it used to put an ASYNC call in
 * the middle of its `||` chain:
 *
 *   const isOnline: true | Promise<boolean | null> =
 *     isConnectedLocal || p2pAutoConnectService.isPeerConnected(cid) || isOnlineRegistration;
 *
 * `isPeerConnected` returns a Promise, and a pending Promise is truthy. So
 * `isOnline` was true whenever the local map said false -- which is every peer
 * at the moment its conversation is created. Every new conversation opened as
 * Online, with `lastUpdate: Date.now()` to make it look freshly observed. The
 * declared type said as much out loud.
 *
 * Only synchronous answers belong here, because this is a synchronous
 * decision. Nothing is lost: `use-conversation-peers` asks the same service and
 * AWAITS it, so the real state arrives through the path built to carry it, and
 * a peer that is genuinely connected is already in the local map this reads
 * first.
 */
import { MessagingLayerType } from '@/types/messaging-layer';
import type { PeerPresence } from './p2p-types';

/**
 * `null` when nothing synchronous says either way: not connected here, and the
 * registry has not said (or the peer hides it). That is "unknown", which the
 * conversation carries as absent presence instead of inventing "Offline".
 */
export function initialPresence(
  isConnectedLocal: boolean,
  registryPresence: boolean | null,
): PeerPresence | null {
  if (!isConnectedLocal && registryPresence === null) return null;
  const isOnline: boolean = isConnectedLocal || registryPresence === true;
  return {
    status: isOnline ? MessagingLayerType.Online : MessagingLayerType.Offline,
    // Zero rather than "now" when offline: nothing has been observed, and a
    // timestamp is a claim that something was.
    lastUpdate: isOnline ? Date.now() : 0,
  };
}
