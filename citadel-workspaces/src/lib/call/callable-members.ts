import type { GroupCallMember } from '@/components/call/GroupCallControls';

/** The parts of a roster entry and a directory entry this needs. */
export interface RosterMember { id: string; username: string; displayName: string }
export interface DirectoryPeer { cid?: bigint; username?: string }

/** Who a call in this room can ring, and who it cannot because you are not connected. */
export interface RoomCallRoster {
  callable: GroupCallMember[];
  /** Display names of members with no P2P connection to you: calls cannot reach them. */
  notConnected: string[];
}

/**
 * The members a call in this room can ring, by CID.
 *
 * A roster id is a USERNAME, not a CID; parsing it as one dropped every member, so no
 * office call could start. The CID comes from the server's peer directory, matched by
 * username. A member the directory does not know is left out rather than guessed.
 *
 * Call signalling and media travel peer to peer, so a member you are not P2P-registered
 * with cannot be rung: measured live, the caller sat on "Calling Max Member…" while Max
 * saw nothing. Such members are named instead, so the caller knows what to do.
 */
export function callableMembers(
  members: readonly RosterMember[],
  directory: readonly DirectoryPeer[],
  selfCid: bigint | undefined,
  connected: ReadonlySet<bigint>,
): RoomCallRoster {
  const cidByUsername: Map<string, bigint> = new Map();
  for (const peer of directory) {
    if (peer.cid !== undefined && peer.username) cidByUsername.set(peer.username, peer.cid);
  }
  const roster: RoomCallRoster = { callable: [], notConnected: [] };
  for (const member of members) {
    const username: string = member.username || member.id;
    const cid: bigint | undefined = cidByUsername.get(username);
    if (cid === undefined || cid === selfCid) continue;
    if (connected.has(cid)) roster.callable.push({ cid, username });
    else roster.notConnected.push(member.displayName || username);
  }
  return roster;
}
