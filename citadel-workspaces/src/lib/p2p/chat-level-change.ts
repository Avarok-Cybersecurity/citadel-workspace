/**
 * Changing one chat's encryption level.
 *
 * The level is read where the channel is opened, where an incoming offer is
 * admitted and where each message is sent (chat-advanced-settings.ts), so a
 * saved change reaches the next channel on its own. A channel that is already
 * up was keyed at the old level, so it is dropped and dialled again -- the
 * same drop Pause uses. A paused contact is only saved: dialling it would
 * break the pause, and Resume dials at the saved level anyway.
 */
import type { ChatAdvancedSettings, ChatSecurityLevel } from './chat-advanced-settings';
import type { PauseLink } from '@/lib/p2p-pause/pause-store';
import type { PauseStatus } from '@/lib/p2p-pause/pause-rules';

export interface ChatLevelChangeDeps {
  save(ownCid: bigint, peerCid: bigint, change: Partial<ChatAdvancedSettings>): Promise<ChatAdvancedSettings>;
  /** The agent answers this account's offers by the level, so it hears it before any redial. */
  tellAgent(ownCid: bigint): Promise<void>;
  pauseStatus(ownCid: bigint, peerCid: bigint): Promise<PauseStatus>;
  link: Pick<PauseLink, 'isConnected' | 'drop' | 'reconnect'>;
  /**
   * Whether the redialled link is up again, within a bound the caller sets. `reconnect`
   * resolving says nothing: with a supervising agent it only asks the agent to dial.
   */
  confirmUp(peerCid: bigint): Promise<boolean>;
}

/** `reconnect-pending`: saved and redialled, but the link was not back within the bound. */
export type ChatLevelOutcome = 'reconnected' | 'reconnect-pending' | 'saved-not-connected' | 'saved-paused';

export interface ChatLevelResult {
  settings: ChatAdvancedSettings;
  outcome: ChatLevelOutcome;
}

export async function changeChatLevel(
  deps: ChatLevelChangeDeps,
  ownCid: bigint,
  peerCid: bigint,
  level: ChatSecurityLevel,
): Promise<ChatLevelResult> {
  const settings: ChatAdvancedSettings = await deps.save(ownCid, peerCid, { securityLevel: level });
  await deps.tellAgent(ownCid);
  // Unknown is treated as paused: redialling a contact who may be paused
  // breaks the promise the pause made.
  if ((await deps.pauseStatus(ownCid, peerCid)) !== 'active') return { settings, outcome: 'saved-paused' };
  if (!deps.link.isConnected(ownCid, peerCid)) return { settings, outcome: 'saved-not-connected' };
  await deps.link.drop(ownCid, peerCid);
  await deps.link.reconnect(peerCid);
  return { settings, outcome: (await deps.confirmUp(peerCid)) ? 'reconnected' : 'reconnect-pending' };
}

/** What the change did, in the Advanced tab's status line. */
export function chatLevelStatus(result: ChatLevelResult): string {
  const level: ChatSecurityLevel = result.settings.securityLevel;
  switch (result.outcome) {
    case 'reconnected': return `Saved. Reconnected at ${level}; new messages use it.`;
    case 'reconnect-pending': return `Saved. Not reconnected yet: the chat reconnects at ${level} as soon as the other side can be reached.`;
    case 'saved-not-connected': return `Saved. The next connection to this chat uses ${level}.`;
    case 'saved-paused': return `Saved. The connection is paused; resuming it connects at ${level}.`;
  }
}
