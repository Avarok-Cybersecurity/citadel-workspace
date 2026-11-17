/**
 * What workspace members are called, by username, for surfaces that only know
 * a username.
 *
 * P2P surfaces -- the chat header, pending requests, the peer list -- get a
 * peer's username from the agent (`peer_username`) and nothing else, so a peer
 * who registered as "Bob Brown" was shown as `bob0924` there even once the
 * member list said "Bob Brown". The member list is where the display name
 * lives; this remembers it, fed from every `Members` response, and
 * `peerDisplayName` consults it when it was given no full name.
 *
 * Merged, never replaced: a room's roster is a subset of the workspace's, and
 * a name learnt from one is still true. Per tab, like the session it serves;
 * a later roster overwrites any name it disagrees with.
 */
import { eventEmitter } from '@/lib/event-emitter';

const displayNames: Map<string, string> = new Map();

/**
 * A mapped member. Its `id` is the account's username -- the server keys
 * users by it -- and is what the agent reports as `peer_username`.
 */
export interface NamedMember {
  id?: string;
  displayName: string;
}

export function recordMemberNames(members: readonly NamedMember[]): void {
  let learnt: boolean = false;
  for (const { id, displayName } of members) {
    const name: string = displayName.trim();
    if (id && name && name !== id && displayNames.get(id) !== name) {
      displayNames.set(id, name);
      learnt = true;
    }
  }
  // Surfaces that named someone before the roster loaded follow it (see withRosterName).
  if (learnt) eventEmitter.emit('member-names:recorded', undefined);
}

/** The member's display name, when it is something other than the username. */
export function memberDisplayName(username: string | null | undefined): string | undefined {
  return username ? displayNames.get(username.trim()) : undefined;
}

/**
 * Usernames the agent listed for peers, by CID.
 *
 * The registration service's cache is filled only by registrations THIS tab
 * saw, so in a fresh browser a registered peer the sidebar lists (from the
 * agent) was unknown to every CID-only surface -- a call from alice rang as
 * "Peer 6W1TP1" beside a sidebar row reading "Alice Anders". The sidebar's
 * listing is recorded here (use-registered-peers) and roster-peer-name falls
 * back to it. Callers record real usernames only, never placeholders.
 */
const peerUsernames: Map<bigint, string> = new Map();

export function recordPeerUsernames(peers: readonly { cid: bigint; username: string }[]): void {
  for (const { cid, username } of peers) peerUsernames.set(cid, username);
}

export function listedPeerUsername(cid: bigint): string | undefined {
  return peerUsernames.get(cid);
}
