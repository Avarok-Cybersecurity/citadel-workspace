/**
 * Where a peer group's transport meets the peer wire and the local stores: the only module of its
 * own that does, so peer-group-transport is tested with this port replaced and nothing else.
 */
import { markChannelOpen } from '@/lib/group-conversations/open-channel';
import { restoreGroupTranscript } from '@/lib/group-conversations/group-transcript-store';
import { sendGroupMessageAnywhere } from '@/lib/group-conversations/send-group-message';
import { reactInGroup } from '@/lib/group-conversations/group-reactions';
import { sendGroupFile } from '@/lib/group-conversations/send-group-file';
import { getGroups, updateGroups } from '@/lib/group-conversations/group-store';
import { markGroupRead } from '@/lib/group-conversations/mark-group-read';
import { fileTransferService } from '@/lib/file-transfer';
import type { GroupConversation, GroupMember } from '@/types/group';
import { groupLog } from './group-log';
import type { GroupLog } from './group-history';

/** What a peer group's adapter asks of the peer wire and the local stores. */
export interface PeerGroupChatIO {
  readonly log: GroupLog;
  restore(): Promise<void>;
  send(content: string, replyTo: string | null): Promise<void>;
  react(messageId: string, emoji: string): Promise<void>;
  share(file: File): Promise<void>;
  markRead(): void;
  focus(): () => void;
  /** The group's members as the roster holds them now. */
  members(): readonly GroupMember[];
  readonly transfers: Pick<typeof fileTransferService, 'acceptTransfer' | 'declineTransfer' | 'cancelTransfer'>;
}

export function peerGroupChatIO(groupId: string): PeerGroupChatIO {
  return {
    log: groupLog(groupId),
    restore: (): Promise<void> => restoreGroupTranscript(groupId),
    send: (content: string, replyTo: string | null): Promise<void> => sendGroupMessageAnywhere(groupId, content, replyTo ?? undefined),
    react: (messageId: string, emoji: string): Promise<void> => reactInGroup(groupId, messageId, emoji),
    share: async (file: File): Promise<void> => { await sendGroupFile(groupId, file); },
    markRead: (): void => updateGroups((prev: GroupConversation[]): GroupConversation[] => markGroupRead(prev, groupId)),
    focus: (): (() => void) => markChannelOpen(groupId),
    members: (): readonly GroupMember[] => getGroups().find((g: GroupConversation): boolean => g.id === groupId)?.members ?? [],
    transfers: fileTransferService,
  };
}
