/**
 * The messenger's two seams onto an agent that hosts the account: the event
 * stream it applies (conversation-events.ts) and the requests it makes
 * (agent-actions.ts). Bound once, by the messenger, to its own state.
 */
import type { ConversationEvent } from 'citadel-internal-service-wasm-client';
import { debugLog, errorLog } from '@/lib/debug-config';
import { createConversationEventApplier, conversationEventOf, type ConversationEventDeps } from './conversation-events';
import type { AgentActionDeps } from './agent-actions';
import { chatAdvancedSettings } from '../p2p/chat-advanced-settings';
import { agentHostsConversations } from './capabilities';
import { pushAccountPreferences } from './push-preferences';
import { onPrivacySettingsSaved } from '../privacy-settings';
import { createFocusReporter, windowInFront, type FocusReporter } from './report-focus';
import { SESSION_CLAIMED, type ClaimedEvent } from '../multi-instance/claim-relay';
import { sendToAgent } from './sender';
import { createPreferencesTeller, type PreferencesTeller } from './tell-preferences';

type Listen = (event: string, handler: (data: unknown) => void) => void;

export interface AgentConversationParts extends ConversationEventDeps {
  findMessage: AgentActionDeps['findMessage'];
  /** The conversation this window has open, if any. */
  activePeer: () => bigint | null;
  /** The peers this account has conversations with, for their retention periods. */
  peers: () => bigint[];
}

/** What the messenger keeps: the actions' seam, and a nudge when its open conversation changes. */
export type AgentBindings = AgentActionDeps & { focusChanged: () => void };

/** Apply every ConversationEvent this window receives; answer what agent actions need. */
export function bindAgentConversations(listen: Listen, parts: AgentConversationParts): AgentBindings {
  const apply: (event: ConversationEvent) => Promise<void> = createConversationEventApplier(parts);
  const watchers: Set<(event: ConversationEvent) => void> = new Set();

  // One at a time, in arrival order: applying awaits, and an Updated overtaking
  // the Appended it follows would update a message the window does not hold yet.
  let applied: Promise<void> = Promise.resolve();
  listen('websocket-message', (message: unknown): void => {
    const event: ConversationEvent | null = conversationEventOf(message);
    if (!event) return;
    applied = applied
      .then(() => apply(event))
      .catch((error: unknown): void => errorLog('AgentConversations', `could not apply a ${event.kind} event`, error))
      // Watchers after the window holds the change: a send's composer clears
      // once its bubble is on screen, not before.
      .then((): void => { for (const watch of [...watchers]) watch(event); });
  });

  // The agent acts on these with no window open, so it hears every change.
  const teller: PreferencesTeller = createPreferencesTeller({
    hosts: agentHostsConversations,
    ownCid: parts.ownCid,
    push: (own: bigint): Promise<void> => pushAccountPreferences(own, parts.peers),
    deferred: (own: bigint): void => debugLog('AgentConversations', `settings for ${own.toString().slice(0, 8)}... wait for this connection to claim the session`),
  });
  const untold = (error: unknown): void => errorLog('AgentConversations', 'could not tell the agent this account\'s settings', error);
  const told = (): void => { teller.changed().catch(untold); };
  listen('p2p:messages-loaded', told);
  onPrivacySettingsSaved(told);

  // What this window has in front of the user, for the agent's native notices.
  const reporter: FocusReporter = createFocusReporter({
    hosts: agentHostsConversations, ownCid: parts.ownCid, activePeer: parts.activePeer, inFront: windowInFront, send: sendToAgent,
  });
  const failed = (error: unknown): void => errorLog('AgentConversations', 'could not tell the agent what is in front', error);
  const focusChanged = (): void => { reporter.changed().catch(failed); };
  // Said again on every connection that claims this session: see report-focus.ts.
  listen(SESSION_CLAIMED, (event: unknown): void => {
    const { cid }: ClaimedEvent = event as ClaimedEvent;
    reporter.claimed(cid).catch(failed);
    teller.claimed(cid).catch(untold);
  });
  window.addEventListener('focus', focusChanged);
  window.addEventListener('blur', focusChanged);
  document.addEventListener('visibilitychange', focusChanged);

  return {
    focusChanged,
    ownCid: parts.ownCid,
    securityLevel: async (ownCid: bigint, peerCid: bigint) => (await chatAdvancedSettings.get(ownCid, peerCid)).securityLevel,
    findMessage: parts.findMessage,
    onEvent: (listener: (event: ConversationEvent) => void): (() => void) => {
      watchers.add(listener);
      return (): void => { watchers.delete(listener); };
    },
    now: (): number => Date.now(),
  };
}
