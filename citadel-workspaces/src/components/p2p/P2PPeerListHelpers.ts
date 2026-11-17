/**
 * Types, constants, and helpers for P2PPeerList component.
 */
import { peerDisplayName } from '@/lib/peer-display';
import type { Peer } from '@/lib/p2p-registration-service';

export interface PeerInfo {
  cid: string;
  name: string;
  /** The roster key, and so what finds the peer's picture; `name` is a display name. */
  username: string;
  isConnected: boolean;
  unreadCount: number;
  lastMessage?: string;
  lastMessageTime?: number;
}

/**
 * A conversation row's name: the registered peer's identity, as the sidebar
 * shows it. The conversation record's own username is only a fallback; one
 * created from an incoming message has none, and the row read "Peer D7U2E0"
 * beside a sidebar that said "Thomas Braun".
 */
export function conversationPeerName(peerCid: bigint, conversationUsername: string | undefined, registered: readonly Peer[]): string {
  const peer: Peer | undefined = registered.find((p: Peer): boolean => p.cid === peerCid);
  return peerDisplayName({ cid: peerCid, username: peer?.username ?? conversationUsername, fullName: peer?.fullName });
}

/**
 * The roster key for a conversation's peer. A peer with no username yet (a conversation opened
 * by an incoming message) has none to look a picture up by, so the name stands in: it matches
 * nothing and the avatar shows initials, which is the honest answer.
 */
export function conversationPeerUsername(peerCid: bigint, conversationUsername: string | undefined, registered: readonly Peer[]): string {
  const peer: Peer | undefined = registered.find((p: Peer): boolean => p.cid === peerCid);
  return peer?.username ?? conversationUsername ?? conversationPeerName(peerCid, conversationUsername, registered);
}
