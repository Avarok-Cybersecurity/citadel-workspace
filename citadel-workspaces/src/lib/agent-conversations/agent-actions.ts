/**
 * The messenger's compound actions, when the agent hosts the account.
 *
 * In the browser path each of these is two steps the window carries out: write
 * the stored transcript, then tell the peer. When the agent hosts the account
 * both steps are the agent's, in one request, under its per-peer lock, so the
 * window only asks. What changed comes back as a `ConversationEvent`, applied
 * by conversation-events.ts in this window and every other one alike; nothing
 * here touches the in-memory transcript itself.
 */
import type { ConversationEvent } from 'citadel-internal-service-wasm-client';
import type { P2PMessage } from '../p2p/p2p-types';
import type { SendMessageOptions } from '../p2p/message-sender-types';
import type { ChatSecurityLevel } from '../p2p/chat-advanced-settings';
import { toggleReaction, type ReactionChange } from '../reactions/reaction-state';
import { agentConversations, type Outgoing } from './requests';
import { isSelfConversation, NotesNeedAgentUpdate } from '../scratchpad/self-conversation';

export interface AgentActionDeps {
  ownCid: () => Promise<bigint | null>;
  securityLevel: (ownCid: bigint, peerCid: bigint) => Promise<ChatSecurityLevel>;
  /** The held or stored message, for its current reactions. */
  findMessage: (peerCid: bigint, messageId: string) => Promise<P2PMessage | null>;
  /** Every ConversationEvent this window receives, until the returned stop. */
  onEvent: (listener: (event: ConversationEvent) => void) => () => void;
  now: () => number;
  /** Whether the agent keeps the scratchpad unsent (capabilities.ts `notesToSelf`). */
  keepsNotesToSelf: () => Promise<boolean>;
}

/**
 * The account's cid, for an action in its conversation with `peerCid`. The scratchpad (the
 * account's own cid) is asked of an agent only if it says it sends none of it: one that does not
 * would queue a note for the account's own cid and retry it through the server.
 */
async function own(deps: AgentActionDeps, peerCid: bigint): Promise<bigint> {
  const cid: bigint | null = await deps.ownCid();
  if (cid === null) throw new Error('Not connected to server');
  if (isSelfConversation(cid, peerCid) && !(await deps.keepsNotesToSelf())) throw new NotesNeedAgentUpdate();
  return cid;
}

function answered(message: P2PMessage | null, what: string): P2PMessage {
  if (!message) throw new Error(`The agent stored no message for this ${what}`);
  return message;
}

/**
 * Send `content`. `onOptimisticAppend` fires when the agent announces the
 * stored, pending message -- the moment it is on screen and retryable -- which
 * is before the send's own answer. A failure before that keeps the composer's
 * text, as in the browser path.
 */
export async function sendThroughAgent(
  deps: AgentActionDeps,
  peerCid: bigint,
  content: string,
  options?: SendMessageOptions,
): Promise<P2PMessage> {
  const cid: bigint = await own(deps, peerCid);
  const out: Outgoing = {
    content,
    message_type: options?.messageType ?? 'text',
    reply_to: options?.reply_to ?? null,
    mentions: options?.mentions ?? null,
    attachments: options?.attachments ?? null,
    document_id: options?.documentId ?? null,
    document_title: options?.documentTitle ?? null,
    security_level: await deps.securityLevel(cid, peerCid),
  };
  const requestId: string = crypto.randomUUID();
  let appended: boolean = false;
  let stop: () => void = (): void => undefined;
  const shown = (): void => {
    if (appended) return;
    appended = true;
    stop();
    options?.onOptimisticAppend?.();
  };
  stop = deps.onEvent((event: ConversationEvent): void => {
    if (event.request_id === requestId && event.kind === 'Appended') shown();
  });
  try {
    const message: P2PMessage = answered(await agentConversations.send(cid, peerCid, out, requestId), 'send');
    shown();
    return message;
  } finally {
    stop();
  }
}

export async function resendThroughAgent(deps: AgentActionDeps, peerCid: bigint, messageId: string): Promise<void> {
  await agentConversations.resend(await own(deps, peerCid), peerCid, messageId);
}

export async function editThroughAgent(deps: AgentActionDeps, peerCid: bigint, messageId: string, contents: string): Promise<void> {
  await agentConversations.edit(await own(deps, peerCid), peerCid, messageId, contents);
}

export async function deleteThroughAgent(deps: AgentActionDeps, peerCid: bigint, messageId: string): Promise<void> {
  await agentConversations.remove(await own(deps, peerCid), peerCid, messageId);
}

/** Toggle our reaction: on if we have not reacted with `emoji`, off if we have. */
export async function reactThroughAgent(deps: AgentActionDeps, peerCid: bigint, messageId: string, emoji: string): Promise<void> {
  const cid: bigint = await own(deps, peerCid);
  const held: P2PMessage | null = await deps.findMessage(peerCid, messageId);
  if (!held) throw new Error(`Cannot react to message ${messageId}: it is not in this conversation`);
  const change: ReactionChange = toggleReaction(held.reactions, emoji, cid, deps.now());
  await agentConversations.react(cid, peerCid, messageId, change.emoji, change.active);
}

/**
 * Everything from `peerCid` is read. The agent marks every delivered message
 * from the peer, which covers any subset a caller names, and sends the
 * receipts only if the user allows them (the preferences it was given).
 */
export async function markReadThroughAgent(deps: AgentActionDeps, peerCid: bigint): Promise<void> {
  await agentConversations.markRead(await own(deps, peerCid), peerCid);
}
