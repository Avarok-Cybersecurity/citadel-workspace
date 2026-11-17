/**
 * Which wire a group message goes out on.
 *
 * There are two kinds of group behind one chat view. A node-backed chat channel
 * belongs to the workspace server, which authorises it by resolving the channel
 * to the node that owns it. A peer group is a Citadel message group keyed
 * `<cid>:<mgid>`, owned by no node, and that same server refuses it —
 * correctly, because the channel is not its:
 *
 *   Permission denied: not a member of this chat channel
 *
 * `useGroupChat` sent both through the workspace protocol, so peer-group chat
 * failed in both directions while creating, inviting, leaving, kicking and
 * listing a peer group all worked. CI caught it as `test:peer-group` passing
 * every step up to messaging.
 *
 * The two id spaces are already distinguishable: `groupIdToKey` throws on
 * anything that is not `<cid>:<mgid>`, and it is the one parser for that shape.
 * A separate flag on the conversation would be a second answer to a question
 * the id already settles.
 */
import { isValidGroupId } from './group-key';

export type GroupSendTransport = 'peer' | 'workspace';

export function groupSendTransport(groupId: string): GroupSendTransport {
  // Unparseable falls to the workspace side deliberately: the peer wire would
  // reject it outright, while the server answers with a message naming the
  // channel, which is the more useful failure to show someone.
  return isValidGroupId(groupId) ? 'peer' : 'workspace';
}
