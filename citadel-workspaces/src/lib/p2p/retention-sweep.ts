/**
 * Message Retention, bound to this app: the signed-in account and the agent
 * that keeps its conversations (retention-runner.ts says what a window does).
 */
import { createRetention, type RetentionRunner } from './retention-runner';
import { getCurrentCid } from './current-cid';
import { pushAccountPreferences } from '../agent-conversations/push-preferences';
import { agentStore } from '../agent-conversations/agent-store';
import { conversationPeers } from './tell-agent-settings';

const runner: RetentionRunner = createRetention({
  currentCid: getCurrentCid,
  tell: (own: bigint): Promise<void> => pushAccountPreferences(own, conversationPeers),
  count: async (peerCid: bigint): Promise<number> => (await agentStore.loadMetadata(peerCid))?.totalMessageCount ?? 0,
});

/** A chat's period was just changed: told to the agent that keeps the store. */
export function retentionChanged(peerCid: bigint): Promise<number> {
  return runner.retentionChanged(peerCid);
}
