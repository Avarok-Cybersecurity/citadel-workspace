/**
 * Reactions in a peer group: applying one, binding the inbound event, and
 * sending our own.
 *
 * Applied in TWO places, deliberately, because they hold different things: the
 * messaging manager's in-memory thread (what an open conversation renders) and
 * the stored transcript (what the next open or reload reads). A reaction that
 * arrives while the group is closed has no in-memory message to land on, and
 * must still reach disk. Both folds are idempotent, so a redelivery is a no-op
 * in each.
 *
 * Peer groups only. A node-backed channel's messages belong to the workspace
 * server, which has no reaction operation; group-message-actions does not offer
 * the picker there.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { groupMessagingManager } from '@/lib/group-messaging-manager';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { debugLog } from '@/lib/debug-config';
import { toggleReaction, type ReactionChange } from '@/lib/reactions/reaction-state';
import type { GroupMessage } from '@/types/workspace-entities';
import { encodeGroupReaction } from './group-reaction-codec';
import { groupSendTransport } from './group-send-transport';
import { recordTranscriptChange } from './group-transcript-store';
import type { GroupReactionEvent } from './peer-group-reaction-inbound';

export function applyGroupReaction(event: GroupReactionEvent): Promise<void> {
  if (groupSendTransport(event.groupId) !== 'peer') return Promise.resolve();
  groupMessagingManager.handleReactionChanged(event.groupId, event.messageId, event.change);
  return recordTranscriptChange(event.groupId, { kind: 'react', messageId: event.messageId, change: event.change });
}

export function bindGroupReactions(): () => void {
  const onReceived = (data: GroupReactionEvent): void => {
    applyGroupReaction(data).catch((error: unknown): void => {
      debugLog('GroupReactions', 'Recording a reaction failed', error);
    });
  };
  eventEmitter.on('group:reaction-received', onReceived);
  return (): void => { eventEmitter.off('group:reaction-received', onReceived); };
}

/**
 * Toggle our own `emoji` on a message, locally first and then for the members.
 * The server does not echo a peer-group body to its sender, so the local apply
 * is the only way our own reaction reaches our screen.
 */
export async function reactInGroup(groupId: string, messageId: string, emoji: string): Promise<void> {
  if (groupSendTransport(groupId) !== 'peer') throw new Error('Reactions are only carried in peer groups');
  const self: bigint | null = instanceManager.cid;
  if (self === null) throw new Error('Not connected to server');
  const target: GroupMessage | undefined = groupMessagingManager.getMessages(groupId).messages.find((m) => m.id === messageId);
  if (!target) throw new Error(`Cannot react to message ${messageId}: it is not loaded`);

  const change: ReactionChange = toggleReaction(target.reactions, emoji, self, Date.now());
  await applyGroupReaction({ groupId, messageId, change });

  // Lazily, as announce-group-state does: group-requests reaches the socket stack.
  const { sendPeerGroupBody } = await import('./group-requests');
  await sendPeerGroupBody(groupId, (senderCid: bigint, envelopeId: string): Uint8Array => encodeGroupReaction({
    group_id: groupId,
    message_id: envelopeId,
    sender_cid: senderCid,
    timestamp: Date.now(),
    reaction: { target_id: messageId, emoji: change.emoji, active: change.active, at: change.at },
  }));
}
