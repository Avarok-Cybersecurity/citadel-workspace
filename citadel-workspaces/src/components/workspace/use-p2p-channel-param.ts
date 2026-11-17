import { useRegisteredPeers, type RegisteredPeer } from '@/hooks/use-registered-peers';

/**
 * The peer CID a P2P chat link names, from `channel` or -- when the link names only the
 * peer (`?showP2P=true&p2pUser=bob0924`) -- from the registered peer with that username.
 *
 * Measured live: a link without `channel` loaded the workspace and never opened the chat.
 * The app's own links always carry `channel`; a hand-written or shared one need not.
 */
export function resolveP2PChannel(
  channel: string | null,
  peerName: string | null,
  peers: readonly RegisteredPeer[],
): string | null {
  if (channel) return channel;
  if (!peerName) return null;
  return peers.find((p: RegisteredPeer) => p.username === peerName)?.cid ?? null;
}

export function useP2PChannelParam(channel: string | null, peerName: string | null): string | null {
  const { registeredPeers } = useRegisteredPeers();
  return resolveP2PChannel(channel, peerName, registeredPeers);
}
