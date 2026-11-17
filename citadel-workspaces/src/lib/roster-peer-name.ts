import { p2pRegistrationService } from '@/lib/p2p-registration-service';
import { peerDisplayName, peerHandleName } from '@/lib/peer-display';
import { listedPeerUsername } from '@/lib/member-names';

/**
 * The name to show for a peer that the wire identified only by CID.
 *
 * Call signals, group invitations and peer-group messages carry a CID and
 * nothing else, so the name has to be looked up in the registration roster --
 * the same source the peer list and Messages render from, so a person is named
 * identically wherever they appear.
 *
 * Falls back to `peerDisplayName`'s short handle rather than the raw CID: a
 * twenty-digit number is not a person's name, and it is what the incoming-call
 * card, the participant tile, a group's default title ("<cid>'s Group") and a
 * group message's author line would otherwise show.
 */
export function rosterPeerName(cid: bigint): string {
  const match: RosterEntry | undefined = rosterEntry(cid);
  return peerDisplayName({ cid, username: match?.username, fullName: match?.fullName });
}

/** What the roster ADDRESSES a peer by: its username, or the derived handle. See peerHandleName. */
export function rosterPeerUsername(cid: bigint): string {
  return peerHandleName({ cid, username: rosterEntry(cid)?.username });
}

/**
 * A group member's name: the roster by CID first, then the username the group
 * record stored -- unless what it stored is the member's own CID, which some
 * records carry and which is never a person's name.
 */
export function rosterMemberName(member: { cid: bigint; username: string }): string {
  const match: RosterEntry | undefined = rosterEntry(member.cid);
  const stored: string = member.username.trim();
  const username: string | undefined = match?.username ?? (stored && stored !== member.cid.toString() ? stored : undefined);
  return peerDisplayName({ cid: member.cid, username, fullName: match?.fullName });
}

type RosterEntry = { username?: string; fullName?: string };

function rosterEntry(cid: bigint): RosterEntry | undefined {
  const { registeredPeers, allPeers } = p2pRegistrationService.getPeers();
  // Registered peers first — a peer can appear in both, and the registered
  // record is the one whose username the rest of the app trusts.
  const known: RosterEntry | undefined = registeredPeers.find((p): boolean => p.cid === cid) ?? allPeers.find((p): boolean => p.cid === cid);
  // Then what the agent listed for the sidebar; see member-names' listedPeerUsername.
  const listed: string | undefined = known?.username ? undefined : listedPeerUsername(cid);
  return listed === undefined ? known : { ...known, username: listed };
}
