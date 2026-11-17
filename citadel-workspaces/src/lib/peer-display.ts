/**
 * Peer Display
 *
 * How a peer is named in the UI. One module so every surface — conversation
 * list, peer discovery, pending requests, account switcher — answers the
 * question identically.
 *
 * The rule: a CID is an internal routing identifier and is never a person's
 * name. Surfaces previously rendered `User 70409342...` (the first 8 digits of
 * a decimal u64) as the display name and the next 16 digits as the subtitle,
 * which is unreadable, unmemorable, and indistinguishable between two peers
 * whose CIDs happen to share a prefix.
 *
 * When no username is known we derive a SHORT HANDLE instead: base36 of the
 * CID's low bits, which is compact, stable for a given peer, and visibly a
 * handle rather than a truncated number pretending to be a name.
 *
 * "No username is known" is not the same as "the username field is empty". The
 * peer pipeline fills that field with placeholders -- 'Unknown', 'User 7040934',
 * 'Peer 4f2a1c', 'Loading...' -- and five separate sites hand-rolled their own
 * idea of which strings those were, using three different definitions. A peer
 * called 'User 12345' was a placeholder to the registration service and a real
 * name to the sidebar, so the same peer was named differently depending on
 * which surface you looked at, and a placeholder that reached the wrong check
 * was preserved forever in preference to the real name arriving behind it.
 * `isPlaceholderName` is that judgement, once.
 */

import { toCidKey, type CidLike } from './utils/cid-utils';
import { memberDisplayName } from './member-names';

/** Number of base36 characters in a derived handle. */
const HANDLE_LENGTH: number = 6;

/** Characters that read ambiguously in a short code, mapped to clearer ones. */
const AMBIGUOUS: Record<string, string> = { O: '0', I: '1', L: '1' };

/**
 * Names the pipeline invents when it does not know who someone is.
 *
 * Exact strings first, then the shapes: `User <digits>` (a truncated decimal
 * CID) and `Peer <handle>` (this module's own derived handle, which must not be
 * mistaken for a name a person chose if it is fed back in).
 */
const PLACEHOLDER_NAMES: readonly string[] = [
  'Unknown',
  'Unknown Peer',
  'Unknown peer',
  'Unknown User',
  'Loading...',
];

const PLACEHOLDER_SHAPES: readonly RegExp[] = [
  /^User \d+$/,
  // Exactly this module's own handle -- uppercase base36, HANDLE_LENGTH long --
  // and not merely anything after the word "Peer". A first pass matched
  // `Peer [0-9A-Za-z]{4,13}`, which called "Peer Gynt" a placeholder.
  new RegExp(`^Peer [0-9A-Z]{${HANDLE_LENGTH}}$`),
];

/**
 * Whether `name` is one of the pipeline's inventions rather than something a
 * person chose. Empty and whitespace-only names count: they are the absence of
 * a name, which is what every caller means to test for.
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const trimmed: string = (name ?? '').trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_NAMES.includes(trimmed)) return true;
  return PLACEHOLDER_SHAPES.some(shape => shape.test(trimmed));
}

export interface PeerIdentity {
  cid: CidLike;
  username?: string | null;
  fullName?: string | null;
}

/**
 * A short, stable, human-readable handle for a peer with no known username.
 *
 * Derived from the CID's low 32 bits in base36 so it stays compact regardless of
 * how large the CID is. Returns `null` when the CID is unusable, so callers can
 * fall back to a generic label rather than printing a handle for a peer that has
 * no valid identifier at all.
 */
export function shortPeerHandle(cid: CidLike): string | null {
  const key: string = toCidKey(cid);
  if (!key) return null;

  // Low 32 bits keep the handle short while still varying between peers; the
  // full CID in base36 would be up to 13 characters.
  const low: bigint = BigInt(key) & 0xffffffffn;
  const base36: string = low.toString(36).toUpperCase().padStart(HANDLE_LENGTH, '0');
  const tail: string = base36.slice(-HANDLE_LENGTH);

  return tail
    .split('')
    .map(c => AMBIGUOUS[c] ?? c)
    .join('');
}

/**
 * The name to show for a peer.
 *
 * Prefers what the peer calls themselves, then their username, then a derived
 * handle. Note the ordering: `fullName` wins because it is the display name a
 * user chose, while `username` is the login identifier. A caller that knows
 * only the username still gets the member's display name (`member-names.ts`).
 */
export function peerDisplayName(peer: PeerIdentity): string {
  const fullName: string | undefined = peer.fullName?.trim() || memberDisplayName(peer.username);
  if (fullName && !isPlaceholderName(fullName)) return fullName;
  return peerHandleName(peer);
}

/**
 * What a peer is ADDRESSED by: the username when it is real, else the derived
 * handle -- never the display name. Test ids, routes and username lookups key
 * on this; a row keyed by "Bob Brown" is a row no caller can find.
 */
export function peerHandleName(peer: PeerIdentity): string {
  const username: string | undefined = peer.username?.trim();
  if (username && !isPlaceholderName(username)) return username;

  const handle: string | null = shortPeerHandle(peer.cid);
  return handle ? `Peer ${handle}` : 'Unknown peer';
}

/**
 * One or two characters for an avatar fallback.
 *
 * Uses the first letter of a real name where one exists; otherwise the first two
 * characters of the derived handle, which are letters/digits rather than the
 * leading digits of a decimal CID (those were frequently identical across peers).
 */
export function peerInitials(peer: PeerIdentity): string {
  const chosen: string | undefined = peer.fullName?.trim() || memberDisplayName(peer.username) || peer.username?.trim();
  const name: string | undefined = isPlaceholderName(chosen) ? undefined : chosen;
  if (name) return name.slice(0, 1).toUpperCase();

  const handle: string | null = shortPeerHandle(peer.cid);
  return handle ? handle.slice(0, 2) : '?';
}

/**
 * Whether this peer is being shown under a derived handle rather than a name
 * they chose. Lets a surface add a hint ("name not yet shared") instead of
 * silently presenting a handle as though it were an identity.
 */
export function isUnnamedPeer(peer: PeerIdentity): boolean {
  return isPlaceholderName(peer.fullName) && isPlaceholderName(peer.username);
}
