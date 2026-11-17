/**
 * The name a ringing group call shows for its room, resolved by the RECEIVER.
 *
 * A group call's signal carries only `room_id` -- an office or room's chat
 * channel id, or a peer group's id. The ring card printed that id as the room's
 * name ("Incoming video call in 03347dcf-…"). The caller could send a name, but
 * a caller-chosen name is one the caller can make up; the receiver is a member
 * of the room and already holds its real name, so the name comes from there.
 *
 * The card sits above the router and the workspace provider, so the tree's
 * names are published here by the component that owns them
 * (WorkspaceEventHandler) rather than read from context.
 */
import type { DomainNode } from '@/components/layout/sidebar/tree-node-types';
import type { GroupConversation } from '@/types/group';
import { notifyEach } from '@/lib/notify-listeners';
import { DIRECT_CALL, type CallHome } from './call-state';

let channelNames: ReadonlyMap<string, string> = new Map<string, string>();
let channelNodes: ReadonlyMap<string, string> = new Map<string, string>();
const listeners: Set<() => void> = new Set<() => void>();

/** Replace the channel-id → node-name and → node-id maps from the workspace's current nodes. */
export function publishChannelNames(nodes: Readonly<Record<string, DomainNode>>): void {
  const next: Map<string, string> = new Map<string, string>();
  const owners: Map<string, string> = new Map<string, string>();
  for (const node of Object.values(nodes)) {
    if (!node.chat_channel_id) continue;
    owners.set(node.chat_channel_id, node.id);
    if (node.name.trim()) next.set(node.chat_channel_id, node.name.trim());
  }
  channelNames = next;
  channelNodes = owners;
  notifyEach(listeners, 'channel names');
}

export function getChannelNames(): ReadonlyMap<string, string> {
  return channelNames;
}

export function subscribeToChannelNames(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/** The room's name as this user knows it, or null: never the id itself. */
export function roomNameFor(
  roomId: string,
  channels: ReadonlyMap<string, string>,
  groups: readonly GroupConversation[],
): string | null {
  const channel: string | undefined = channels.get(roomId);
  if (channel) return channel;
  const group: GroupConversation | undefined = groups.find((g: GroupConversation): boolean => g.id === roomId);
  const name: string = group?.name.trim() ?? '';
  return name.length > 0 ? name : null;
}

/**
 * Where an incoming call lives, resolved by the receiver for the same reason
 * its name is. A `room_id` is either an office/room chat channel or a peer
 * group's id; a channel this user's tree knows is a node, anything else a group.
 */
export function callHomeOf(roomId: string | null, nodesByChannel: ReadonlyMap<string, string>): CallHome {
  if (roomId === null) return DIRECT_CALL;
  const nodeId: string | undefined = nodesByChannel.get(roomId);
  return nodeId ? { kind: 'node', roomId, nodeId } : { kind: 'group', roomId };
}

export function callHomeFor(roomId: string | null): CallHome {
  return callHomeOf(roomId, channelNodes);
}
