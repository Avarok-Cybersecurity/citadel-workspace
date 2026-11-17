/**
 * A node channel's transport: an office's or room's chat, held by the workspace server.
 *
 * The server stores every message and mints its id, so history pages come from it and the
 * reader's own message is shown at once and confirmed by the server's copy (pending-group-sends).
 * Markdown rides the wire's `Markdown` type. Who may send is the workspace permission system's
 * answer, passed in live. Reactions are the server's: it attributes the reactor and holds the
 * list on the message. Receipts are derived from the members' read cursors and the roster
 * (read-receipts), and the reader's own cursor and typing go out paced below the server's limits
 * (node-read-cursor, node-status). Live documents are shared by a message naming them and kept on
 * the server beside the node's page (nodeDocuments); files are uploaded to the server under the node
 * and shared the same way (node-files).
 */
import type { ValueStore } from '@/lib/value-store';
import type { GroupRestriction } from '@/components/chat/group-restriction';
import type { Clock } from '@/lib/cdoc/collab/ports';
import { debugLog } from '@/lib/debug-config';
import { describeFailure } from '@/lib/failure-message';
import { peerDisplayName } from '@/lib/peer-display';
import { chatFeatures, type StatedFeatures } from './features';
import { groupHistory, type GroupHistory } from './group-history';
import { pendingGroupSends, type PendingSends } from './pending-group-sends';
import type { NodeChatIO } from './node-chat-io';
import { nodeReact, nodeReadCursor, nodeReceipts, nodeTyping, type Roster } from './node-signals';
import type { ReadCursor } from './node-read-cursor';
import { nodeFiles } from './node-files';
import type { OpeningPorts } from '@/components/p2p/chat-document/chat-document-opening';
import type { ChatMessage, ChatSelf, ChatTransport, DocumentInvitation, DocumentPort, SendPort, TextSend } from './chat-transport';

export interface NodeTransportParams {
  readonly channelId: string;
  /** The node the channel belongs to, whose files its shares are. */
  readonly nodeId: string;
  /** How the channel's live documents open (nodeOpeningPorts: on the server, beside its node's page). */
  readonly opening: OpeningPorts;
  /** The office's or room's name, as the pane says it ("Shared live with …"). */
  readonly channelName: string;
  readonly self: ChatSelf | null;
  readonly sendGate: ValueStore<GroupRestriction>;
  readonly io: NodeChatIO;
  /** The channel's members, live; null until they are known. */
  readonly roster: Roster;
  readonly clock: Clock;
  /** A local id for a message being sent; the server's copy replaces it. */
  readonly mintLocalId: () => string;
  readonly now: () => number;
}

/**
 * What a node channel can do that no port says. The server holds its messages, so a per-message
 * security level and a retention window are not properties it has.
 */
export const NODE_FEATURES: StatedFeatures = {
  markdown: true, readReceipts: true, securityLevel: false, retention: false, optimistic: true, namesSenders: true,
};

/** `pending` holds the reader's unconfirmed copies; null sends and lets the server's copy appear. */
function nodeSend(params: NodeTransportParams, history: GroupHistory, pending: PendingSends | null): SendPort {
  const { io, self } = params;
  const deliver = (message: ChatMessage, kind: 'text' | 'markdown', replyTo: string | null): void => {
    io.send(message.content, kind, replyTo).catch((error: unknown): void => {
      // The bubble is the report: it says the send failed, why, and offers Retry.
      const failed: ChatMessage | null = pending?.update(message.id, { status: 'failed', error: describeFailure(error, 'The server did not take it.') }) ?? null;
      if (failed !== null) history.emit({ kind: 'updated', message: { id: failed.id, status: 'failed', error: failed.error } });
    });
  };
  return {
    text: async ({ content, messageType, replyTo, onRecorded }: TextSend): Promise<void> => {
      if (pending === null) {
        await io.send(content, messageType, replyTo);
        onRecorded();
        return;
      }
      if (self === null) throw new Error('This tab has not finished signing in, so the message was not sent.');
      const message: ChatMessage = {
        id: params.mintLocalId(), content, timestamp: params.now(), index: 0, status: 'pending', message_type: messageType,
        ...(replyTo !== null ? { replyTo } : {}),
        author: { own: true, name: self.displayName, username: null }, share: null,
      };
      pending.add(message, { content, reply_to: replyTo, message_type: messageType === 'markdown' ? 'Markdown' : 'Text' });
      history.emit({ kind: 'arrived', message, incoming: false });
      onRecorded();
      deliver(message, messageType, replyTo);
    },
    revise: { edit: io.edit, remove: io.remove },
    react: nodeReact(io, self),
    retry: async (messageId: string): Promise<void> => {
      const failed: ChatMessage | null = pending?.get(messageId) ?? null;
      if (failed === null || failed.status !== 'failed') return;
      pending?.update(messageId, { status: 'pending', error: undefined });
      history.emit({ kind: 'status', messageId, status: 'pending' });
      deliver(failed, failed.message_type === 'markdown' ? 'markdown' : 'text', failed.replyTo ?? null);
    },
  };
}

/** The channel's live documents: shared by a message that names them, kept on the workspace server. */
function nodeDocuments(params: NodeTransportParams): DocumentPort {
  return {
    // Where it is kept first, so a narrow strip truncates the channel's name, never that.
    sharedWith: `On the workspace server, shared live with everyone in ${params.channelName}`,
    opening: params.opening,
    invite: async ({ docId, title, onRecorded }: DocumentInvitation): Promise<void> => {
      await params.io.share(docId, title);
      onRecorded();
    },
    onActivity: params.io.onDocumentActivity,
  };
}

export function createNodeTransport(params: NodeTransportParams): ChatTransport {
  const { channelId, channelName, self, io, roster, clock } = params;
  // Receipts and typing are background traffic: a refusal is logged, and the next read or keystroke retries.
  const report = (error: unknown): void => debugLog('NodeTransport', `channel ${channelId}: ${describeFailure(error, 'refused')}`);
  const cursor: ReadCursor = nodeReadCursor(io, self, clock, report);
  // What the transport does follows what it states: optimistic means the reader's copy shows first.
  const pending: PendingSends | null = NODE_FEATURES.optimistic ? pendingGroupSends() : null;
  const history: GroupHistory = groupHistory({
    self, log: io.log, pages: { latest: io.latest, older: io.older }, pending,
    receipts: self === null ? null : nodeReceipts(io, self, roster),
    markRead: cursor.read,
    focus: io.focus,
    clearNotices: io.clearNotices,
  });
  const ports: Pick<ChatTransport, 'send' | 'status' | 'files' | 'documents' | 'settings'> = {
    send: nodeSend(params, history, pending), status: nodeTyping(io, self, roster, clock, report), files: nodeFiles(io, params.nodeId), documents: nodeDocuments(params), settings: null,
  };
  return {
    kind: 'node',
    conversationKey: `node:${channelId}`,
    self,
    counterpart: { name: channelName, username: null, greeting: `Start the conversation in ${channelName}. Messages are kept on the workspace server.` },
    features: chatFeatures(ports, NODE_FEATURES),
    sendGate: params.sendGate,
    history: history.port,
    ...ports,
    reactorName: (cid: bigint): string => (self !== null && cid === self.cid ? 'You' : peerDisplayName({ cid })),
  };
}
