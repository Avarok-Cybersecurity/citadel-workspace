/**
 * Telling the agent the account's settings (see preferences.ts for which).
 *
 * Pushed when this window's conversations load for an account the agent hosts,
 * when the privacy settings are saved, and when a chat's retention or level changes --
 * every moment the agent's copy could differ from what the user chose.
 */
import type { NotificationPreview } from 'citadel-internal-service-wasm-client';
import { accountPreferences } from './preferences';
import { agentConversations } from './requests';
import { getPrivacySettings } from '../privacy-settings';
import { chatAdvancedSettings, type ChatSecurityLevel, type Retention } from '../p2p/chat-advanced-settings';

/**
 * `preview` replaces the account's notification preview when given (the
 * settings switch); otherwise the agent's current one is kept.
 */
export async function pushAccountPreferences(ownCid: bigint, peers: () => bigint[], preview?: NotificationPreview): Promise<void> {
  const keep: NotificationPreview = preview ?? (await agentConversations.getPreferences(ownCid)).notification_preview;
  await agentConversations.setPreferences(ownCid, await accountPreferences(ownCid, {
    privacy: getPrivacySettings,
    retentionFor: async (own: bigint, peer: bigint): Promise<Retention> => (await chatAdvancedSettings.get(own, peer)).retention,
    levelFor: async (own: bigint, peer: bigint): Promise<ChatSecurityLevel> => (await chatAdvancedSettings.get(own, peer)).securityLevel,
    peers,
  }, keep));
}
