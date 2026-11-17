/**
 * One group's messages as this tab holds them, read from the message manager that the response
 * handler (node channels) and the peer-group delivery (peer groups) both write.
 */
import { groupMessagingManager, type GroupMessageEvent } from '@/lib/group-messaging-manager';
import type { GroupMessage } from '@/types/workspace-entities';
import type { GroupLog } from './group-history';

export function groupLog(groupId: string): GroupLog {
  return {
    messages: (): readonly GroupMessage[] => groupMessagingManager.getMessages(groupId).messages,
    hasMore: (): boolean => groupMessagingManager.getMessages(groupId).hasMore,
    subscribe: (listener: (event: GroupMessageEvent) => void): (() => void) => groupMessagingManager.subscribeToGroup(groupId, listener),
  };
}
