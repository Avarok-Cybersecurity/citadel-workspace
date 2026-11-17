/**
 * Which writer carries out a compound action: the agent, when it hosts the
 * account (agent 0.8.6, multi-window), or this window (every older agent).
 *
 * Same signatures as the browser-path functions they wrap, plus the agent's
 * seam first, so the messenger routes by changing an import and not a body.
 * The browser path is the one for agents before 0.8.6; see
 * docs/plans/multi-window-sessions.md for when it can go.
 */
import type { MessagingLayer } from '@/types/messaging-layer';
import { agentHostsConversations } from '../agent-conversations/capabilities';
import {
  editThroughAgent, deleteThroughAgent, reactThroughAgent, markReadThroughAgent, type AgentActionDeps,
} from '../agent-conversations/agent-actions';
import { editMessage as editHere, deleteMessage as deleteHere } from './messenger-revision';
import { reactToMessage as reactHere } from './messenger-reaction';
import { markMessagesAsRead as markReadHere } from './messenger-compatibility';
import type { ConversationManager } from './conversation-manager';

type EmitFn = (event: string, data?: unknown) => void;
type SendRawFn = (recipientCid: bigint, layer: MessagingLayer) => Promise<void>;
type AckFn = (messageId: string, ackType: 'delivered' | 'read' | 'failed', peerCid: bigint) => Promise<void>;

export async function editMessage(
  agent: AgentActionDeps, conversations: ConversationManager, emit: EmitFn, sendRaw: SendRawFn,
  peerCid: bigint, messageId: string, contents: string,
): Promise<void> {
  if (await agentHostsConversations()) return editThroughAgent(agent, peerCid, messageId, contents);
  return editHere(conversations, emit, sendRaw, peerCid, messageId, contents);
}

export async function deleteMessage(
  agent: AgentActionDeps, conversations: ConversationManager, emit: EmitFn, sendRaw: SendRawFn,
  peerCid: bigint, messageId: string,
): Promise<void> {
  if (await agentHostsConversations()) return deleteThroughAgent(agent, peerCid, messageId);
  return deleteHere(conversations, emit, sendRaw, peerCid, messageId);
}

export async function reactToMessage(
  agent: AgentActionDeps, conversations: ConversationManager, emit: EmitFn, sendRaw: SendRawFn,
  peerCid: bigint, messageId: string, emoji: string,
): Promise<void> {
  if (await agentHostsConversations()) return reactThroughAgent(agent, peerCid, messageId, emoji);
  return reactHere(conversations, emit, sendRaw, peerCid, messageId, emoji);
}

export async function markMessagesAsRead(
  agent: AgentActionDeps, conversations: ConversationManager, sendAck: AckFn, emit: EmitFn,
  peerCid: bigint, messageIds?: string[],
): Promise<void> {
  if (await agentHostsConversations()) return markReadThroughAgent(agent, peerCid);
  return markReadHere(conversations, sendAck, emit, peerCid, messageIds);
}
