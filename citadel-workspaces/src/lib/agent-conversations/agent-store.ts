/**
 * The conversation store, which the agent keeps.
 *
 * Reads come from `ConversationPage` / `ConversationList`,
 * and the two writes a window still authors -- filing a record it built (a file
 * offer, a notice) and patching delivery or transfer state -- become
 * `ConversationRecord` / `ConversationPatch`. A window never reads or writes the
 * agent's LocalDB records itself.
 *
 * The compound actions (sending, editing, reacting, marking read) do not come
 * through here: the agent both stores them and tells the peer, in one request
 * each (agent-actions.ts).
 */
import type { MessagePatch } from 'citadel-internal-service-wasm-client';
import type { ConversationMetadata, MessagePage, P2PMessage } from '../p2p/p2p-types';
import { agentConversations } from './requests';
import { getCurrentCid } from '../p2p/current-cid';

async function own(): Promise<bigint> {
  const cid: bigint | null = await getCurrentCid();
  if (cid === null) throw new Error('No session: the agent keeps conversations per account');
  return cid;
}

/** The fields a window may patch on a stored message (the agent's `MessagePatch`). */
export function toPatch(updates: Partial<P2PMessage>): MessagePatch {
  const allowed: ReadonlyArray<keyof MessagePatch> = [
    'status', 'error', 'transfer_state', 'transfer_progress', 'virtual_path', 'file_thumbnail',
  ];
  const extra: string[] = Object.keys(updates).filter((k) => !allowed.includes(k as keyof MessagePatch));
  if (extra.length > 0) throw new Error(`The agent does not let a window change ${extra.join(', ')}`);
  return { ...updates } as MessagePatch;
}

async function newest(peerCid: bigint): Promise<{ metadata: ConversationMetadata | null; page: MessagePage | null }> {
  return agentConversations.page(await own(), peerCid, null);
}

/** The store surface the agent answers. */
export interface AgentStore {
  loadAllMetadata(): Promise<ConversationMetadata[]>;
  loadMetadata(peerCid: bigint): Promise<ConversationMetadata | null>;
  loadMessagePage(peerCid: bigint, pageNumber: number): Promise<MessagePage | null>;
  loadLatestMessages(peerCid: bigint): Promise<P2PMessage[]>;
  findMessageInPages(peerCid: bigint, messageId: string): Promise<P2PMessage | null>;
  appendMessageToPage(peerCid: bigint, message: P2PMessage): Promise<void>;
  updateMessageInPages(peerCid: bigint, messageId: string, updates: Partial<P2PMessage>): Promise<boolean>;
  deleteConversationPages(peerCid: bigint): Promise<void>;
}

export const agentStore: AgentStore = {
  async loadAllMetadata(): Promise<ConversationMetadata[]> {
    return agentConversations.list(await own());
  },
  async loadMetadata(peerCid: bigint): Promise<ConversationMetadata | null> {
    return (await newest(peerCid)).metadata;
  },
  async loadMessagePage(peerCid: bigint, pageNumber: number): Promise<MessagePage | null> {
    return (await agentConversations.page(await own(), peerCid, pageNumber)).page;
  },
  async loadLatestMessages(peerCid: bigint): Promise<P2PMessage[]> {
    return (await newest(peerCid)).page?.messages ?? [];
  },
  async findMessageInPages(peerCid: bigint, messageId: string): Promise<P2PMessage | null> {
    const cid: bigint = await own();
    const { metadata, page } = await agentConversations.page(cid, peerCid, null);
    for (let number: number = metadata?.latestPage ?? -1; number >= 0; number--) {
      const current: MessagePage | null = number === metadata?.latestPage ? page : (await agentConversations.page(cid, peerCid, number)).page;
      const found: P2PMessage | undefined = current?.messages.find((m) => m.id === messageId);
      if (found) return found;
    }
    return null;
  },
  async appendMessageToPage(peerCid: bigint, message: P2PMessage): Promise<void> {
    await agentConversations.record(await own(), peerCid, message);
  },
  async updateMessageInPages(peerCid: bigint, messageId: string, updates: Partial<P2PMessage>): Promise<boolean> {
    return (await agentConversations.patch(await own(), peerCid, messageId, toPatch(updates))) !== null;
  },
  async deleteConversationPages(peerCid: bigint): Promise<void> {
    await agentConversations.clear(await own(), peerCid);
  },
};
