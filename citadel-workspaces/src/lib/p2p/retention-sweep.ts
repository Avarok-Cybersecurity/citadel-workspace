/**
 * Message Retention, bound to this app: the agent's LocalDB, the peer write
 * lock, the in-memory conversation cache and the open chat view.
 *
 * `applyRetention` runs when a chat is opened and when its period is changed;
 * `startRetentionSweeper` (called once at boot) repeats it for every chat of
 * the signed-in account every hour, so a period applies to chats nobody opens.
 */
import { createRetention, type RetentionRunner } from './retention-runner';
import { retained, MESSAGES_EXPIRED_EVENT, type MessagesExpired } from './retention';
import { chatAdvancedSettings } from './chat-advanced-settings';
import { getCurrentCid } from './current-cid';
import { withPeerLock } from './peer-write-lock';
import { loadMetadata, loadMessagePage, saveMessagePage, saveMetadata } from './message-page-operations';
import { p2pMessengerManager } from './p2p-messenger-manager';
import { eventEmitter } from '../event-emitter';
import { errorLog } from '@/lib/debug-config';
import { agentHostsConversations } from '../agent-conversations/capabilities';
import { pushAccountPreferences } from '../agent-conversations/push-preferences';
import { agentStore } from '../agent-conversations/agent-store';
import { conversationPeers } from './tell-agent-settings';
import type { P2PConversation } from './p2p-types';

/** How often every chat is re-checked. An hour: periods are counted in days. */
export const RETENTION_SWEEP_INTERVAL_MS: number = 60 * 60 * 1000;

const peers: () => bigint[] = conversationPeers;

const runner: RetentionRunner = createRetention({
  now: (): number => Date.now(),
  currentCid: getCurrentCid,
  settings: chatAdvancedSettings,
  peers,
  lock: withPeerLock,
  onExpired: (peerCid: bigint, cutoff: number): void => {
    const conversation: P2PConversation | undefined = p2pMessengerManager.getConversation(peerCid);
    if (conversation) conversation.messages = retained(conversation.messages, cutoff);
    const event: MessagesExpired = { peerCid, cutoff };
    eventEmitter.emit(MESSAGES_EXPIRED_EVENT, event);
  },
  every: (ms: number, tick: () => void): (() => void) => {
    const handle: ReturnType<typeof setInterval> = setInterval(tick, ms);
    return (): void => clearInterval(handle);
  },
  io: { loadMetadata, loadPage: loadMessagePage, savePage: saveMessagePage, saveMetadata },
  agent: {
    hosts: agentHostsConversations,
    tell: (own: bigint): Promise<void> => pushAccountPreferences(own, peers),
    count: async (peerCid: bigint): Promise<number> => (await agentStore.loadMetadata(peerCid))?.totalMessageCount ?? 0,
  },
});

export function applyRetention(peerCid: bigint): Promise<number> {
  return runner.applyRetention(peerCid);
}

/** A chat's period was just changed: pruned here, or told to the agent that keeps the store. */
export function retentionChanged(peerCid: bigint): Promise<number> {
  return runner.retentionChanged(peerCid);
}

/**
 * On opening a chat, before its history is read, so the view never shows what
 * the period has already expired. A failure is logged and the chat still
 * opens: an unreadable store must not also make the conversation unreachable.
 */
export async function applyRetentionOnOpen(peerCid: bigint): Promise<void> {
  try {
    await runner.applyRetention(peerCid);
  } catch (error: unknown) {
    errorLog('Retention', 'could not apply retention on open', error);
  }
}

/** Sweep now, then every interval. The timer is started once however often this runs. */
export function startRetentionSweeper(): void {
  runner.start(RETENTION_SWEEP_INTERVAL_MS);
  runner.sweepNow().catch((error: unknown): void => errorLog('Retention', 'boot sweep failed; old messages were not all removed', error));
}
