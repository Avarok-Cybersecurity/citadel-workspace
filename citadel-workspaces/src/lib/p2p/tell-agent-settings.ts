/**
 * Telling the agent this account's settings now, when it hosts the account.
 *
 * Awaited by a change the agent must act on before what follows it: a chat's
 * new encryption level is told before the channel is redialled, because the
 * agent answers the peer's offers for this account (with or without a window)
 * and must not admit a re-offer at the old level.
 */
import { p2pMessengerManager } from './p2p-messenger-manager';
import type { P2PConversation } from './p2p-types';
import { agentHostsConversations } from '../agent-conversations/capabilities';
import { pushAccountPreferences } from '../agent-conversations/push-preferences';

/** The peers this account has conversations with: the chats whose settings the agent is told. */
export const conversationPeers = (): bigint[] =>
  p2pMessengerManager.getAllConversations().map((c: P2PConversation): bigint => c.peerCid);

export async function tellAgentAccountSettings(ownCid: bigint): Promise<void> {
  if (await agentHostsConversations()) await pushAccountPreferences(ownCid, conversationPeers);
}
