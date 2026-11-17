/**
 * What a peer-group `GroupMessageNotification` body is: a control message, a
 * reaction, or chat -- decided in that order, in one place.
 *
 * Split from group-events when reactions made a third kind of body. The order
 * matters: neither a control nor a reaction envelope may ever reach the chat
 * path, whatever else it carries.
 */
import type { GroupEvent, PeerNameResolver } from './group-events';
import { peerGroupMessageEvent, type PeerGroupMessageSummary } from './peer-group-inbound';
import { peerGroupControlEvent, type GroupControlEvent } from './peer-group-control-inbound';
import { peerGroupReactionEvent, type GroupReactionEvent } from './peer-group-reaction-inbound';

export function peerGroupBodyEvents(
  groupMessage: Record<string, unknown>,
  peerName: PeerNameResolver,
  selfUsername: string,
): GroupEvent[] {
  const control: GroupControlEvent | null = peerGroupControlEvent(groupMessage);
  if (control) return [{ name: 'group:control-received', payload: { ...control } }];
  const reaction: GroupReactionEvent | null = peerGroupReactionEvent(groupMessage);
  if (reaction) return [{ name: 'group:reaction-received', payload: { ...reaction } }];
  const summary: PeerGroupMessageSummary | null = peerGroupMessageEvent(groupMessage, peerName);
  if (!summary) return [];
  // With who THIS member is, so a group learnt from this message names them. See member-group-record.
  return [{ name: 'group:message-received', payload: { ...summary, selfUsername } }];
}
