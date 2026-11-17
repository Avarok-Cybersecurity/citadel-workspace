/**
 * The two wire messages that say "this session is in these groups".
 *
 * `GroupListJoinedSuccess` is the agent's answer to `GroupListJoined`. And
 * `GroupChannelCreateSuccess` for a group whose key names ANOTHER owner is the
 * SDK re-opening a joined group's channel on (re)connect -- mapped to
 * `group:created`, it recorded this session as the owner of a group it had only
 * joined. The key says who owns it; the session in `cid` is only the member.
 */
import { groupKeyToId, parseGroupKey, type MessageGroupKey } from './group-key';
import type { GroupEvent, PeerNameResolver } from './group-events';
import { variant, toCid } from './group-wire-variants';
import { inviteReceived } from './invite-event';

/**
 * Invitations the agent kept for this session while no tab was open to show them -- absent from
 * an older agent, which does not keep them. They come after the joined list, so a group this
 * answer also lists as joined is already a membership when its invitation is weighed.
 */
function listedInvites(listed: Record<string, unknown>, peerName: PeerNameResolver): GroupEvent[] {
  if (!Array.isArray(listed.pending_invites)) return [];
  return listed.pending_invites.map((invite: unknown): GroupEvent => {
    const { group_key, peer_cid } = (invite ?? {}) as Record<string, unknown>;
    return inviteReceived(group_key, peer_cid, peerName);
  });
}

export function joinedGroupEvents(message: Record<string, unknown>, peerName: PeerNameResolver): GroupEvent[] | null {
  const listed: Record<string, unknown> | undefined = variant(message, 'GroupListJoinedSuccess');
  if (listed) {
    if (!Array.isArray(listed.groups)) return [];
    return [
      { name: 'group:joined-list-received', payload: { groupIds: listed.groups.map((key: unknown) => groupKeyToId(parseGroupKey(key))) } },
      ...listedInvites(listed, peerName),
    ];
  }

  const reopened: Record<string, unknown> | undefined = variant(message, 'GroupChannelCreateSuccess');
  const session: bigint | null = reopened && reopened.request_id == null ? toCid(reopened.cid) : null;
  if (reopened && session !== null) {
    const key: MessageGroupKey = parseGroupKey(reopened.group_key);
    if (key.cid !== session) {
      return [{ name: 'group:joined-list-received', payload: { groupIds: [groupKeyToId(key)] } }];
    }
  }
  return null;
}
