/**
 * A peer group's transport: a Citadel message group of registered peers, owned by no node.
 *
 * Its history is the local transcript (the workspace server refuses a group it does not own, so
 * there are no older pages to ask for). Messages, reactions and files ride the peer wire: a file
 * is offered to each member directly. The wire carries no edit, no delete and no message kind,
 * so those ports are absent and the pane offers none of them. A send is shown when the wire has
 * taken it, which is also when the transport records the sender's own copy.
 */
import type { ValueStore } from '@/lib/value-store';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import { peerDisplayName } from '@/lib/peer-display';
import type { GroupMember } from '@/types/group';
import { chatFeatures } from './features';
import { groupHistory, type GroupHistory } from './group-history';
import type { PeerGroupChatIO } from './peer-group-chat-io';
import type { ChatSelf, ChatTransport, FileOpening, FilePort, FileSendReceipt, SendPort, TextSend } from './chat-transport';

export interface PeerGroupTransportParams {
  readonly groupId: string;
  readonly groupName: string;
  readonly self: ChatSelf | null;
  readonly sendGate: ValueStore<GroupRestriction>;
  readonly io: PeerGroupChatIO;
}

function peerGroupSend(io: PeerGroupChatIO): SendPort {
  return {
    text: async ({ content, replyTo, onRecorded }: TextSend): Promise<void> => {
      await io.send(content, replyTo);
      onRecorded();
    },
    revise: null,
    react: io.react,
    // Nothing is shown before the wire takes it, so there is never a failed copy to resend.
    retry: async (): Promise<void> => undefined,
  };
}

function peerGroupFiles(io: PeerGroupChatIO, groupName: string): FilePort {
  return {
    modes: ['members'],
    destination: `Offered to each member of ${groupName} directly, encrypted end to end.`,
    dialogKey: null,
    send: async (file: File): Promise<FileSendReceipt> => { await io.share(file); return { outcome: 'offered' }; },
    // A member's copy arrives as an ordinary offer in their chat with the sender.
    accept: (transferId: string): Promise<void> => io.transfers.acceptTransfer(transferId),
    decline: (transferId: string): Promise<void> => io.transfers.declineTransfer(transferId),
    cancel: (transferId: string): Promise<void> => io.transfers.cancelTransfer(transferId),
    // Each member's copy is opened from their chat with the sender, where its offer arrived.
    open: async (): Promise<FileOpening> => ({ kind: 'unknown' }),
    read: null,
  };
}

export function createPeerGroupTransport({ groupId, groupName, self, sendGate, io }: PeerGroupTransportParams): ChatTransport {
  const history: GroupHistory = groupHistory({
    self, log: io.log, pages: { latest: io.restore, older: null }, pending: null, receipts: null,
    markRead: io.markRead, focus: io.focus,
    // The group's unread count is its notice; reading the messages clears it.
    clearNotices: io.markRead,
  });
  const ports: Pick<ChatTransport, 'send' | 'status' | 'files' | 'documents' | 'settings'> = {
    send: peerGroupSend(io), status: null, files: peerGroupFiles(io, groupName), documents: null, settings: null,
  };
  return {
    kind: 'peer-group',
    conversationKey: `peer-group:${groupId}`,
    self,
    counterpart: { name: groupName, username: null, greeting: `Start the conversation in ${groupName}. Messages are end-to-end encrypted.` },
    features: chatFeatures(ports, { markdown: false, readReceipts: false, securityLevel: false, retention: false, optimistic: false, namesSenders: true }),
    sendGate,
    history: history.port,
    ...ports,
    // Named from the group's own member list, the way the avatars are, so a reactor reads the same here as in the sidebar.
    reactorName: (cid: bigint): string => {
      if (self !== null && cid === self.cid) return 'You';
      return peerDisplayName({ cid, username: io.members().find((m: GroupMember): boolean => m.cid === cid)?.username });
    },
  };
}
