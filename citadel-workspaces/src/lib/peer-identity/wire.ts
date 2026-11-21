/**
 * What the agent says about a peer's identity key, read off the wire.
 *
 * Each end of a peer connection signs its part of the key exchange with its account's
 * identity key, and the agent pins the key a peer first signed with. The agent is the only
 * keeper of those pins (kernel/p2p_kex); a window asks it and never stores one itself.
 *
 * Only fingerprints cross this wire (`abcd-efgh-ijkl-mnop`). An absent one comes as null or,
 * through the WASM client, as undefined; both read as absent here.
 */
import type { PeerIdentityInfo, PeerIdentityKeyChanged } from 'citadel-internal-service-wasm-client';

/** The pair's fingerprints, as `GetPeerIdentity` answers them. */
export interface PeerIdentityView {
  /** This account's own fingerprint; null for an account with no identity key. */
  own: string | null;
  /** The key pinned for the peer; null before the peer has signed an exchange. */
  pinned: string | null;
  /** A different key the peer signed with since, refused until the person accepts it. */
  pending: string | null;
}

/** A peer whose key changed, as `PeerIdentityKeyChangedNotification` reports it. */
export interface PeerKeyChange {
  cid: bigint;
  peerCid: bigint;
  pinned: string;
  presented: string;
}

function fingerprintOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function peerIdentityViewOf(info: Pick<PeerIdentityInfo, 'own_fingerprint' | 'peer_fingerprint' | 'pending_fingerprint'>): PeerIdentityView {
  return {
    own: fingerprintOrNull(info.own_fingerprint),
    pinned: fingerprintOrNull(info.peer_fingerprint),
    pending: fingerprintOrNull(info.pending_fingerprint),
  };
}

/** The change a wire message carries; null for anything but a well-formed notification. */
export function peerKeyChangeOf(message: unknown): PeerKeyChange | null {
  if (typeof message !== 'object' || message === null) return null;
  const value: unknown = (message as { PeerIdentityKeyChangedNotification?: unknown }).PeerIdentityKeyChangedNotification;
  if (typeof value !== 'object' || value === null) return null;
  const v: Partial<Record<keyof PeerIdentityKeyChanged, unknown>> = value as Partial<Record<keyof PeerIdentityKeyChanged, unknown>>;
  const pinned: string | null = fingerprintOrNull(v.pinned_fingerprint);
  const presented: string | null = fingerprintOrNull(v.presented_fingerprint);
  if (typeof v.cid !== 'bigint' || typeof v.peer_cid !== 'bigint' || pinned === null || presented === null) return null;
  return { cid: v.cid, peerCid: v.peer_cid, pinned, presented };
}

/**
 * The safety number both people read aloud: the two fingerprints in one fixed order, so each
 * end shows the same lines whichever of them is "you". Null until both ends have a key.
 */
export function safetyNumberOf(view: PeerIdentityView): readonly [string, string] | null {
  if (view.own === null || view.pinned === null) return null;
  return view.own <= view.pinned ? [view.own, view.pinned] : [view.pinned, view.own];
}
