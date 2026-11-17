/**
 * What the agent is told about the account: the user's own choices, field for
 * field, and only the chats that expire.
 */
import { describe, it, expect } from 'vitest';
import type { AccountPreferences } from 'citadel-internal-service-wasm-client';
import { accountPreferences, toAgentRetention } from '../preferences';
import { DEFAULT_PRIVACY_SETTINGS, type PrivacySettings } from '../../privacy-settings';
import type { ChatSecurityLevel, Retention } from '../../p2p/chat-advanced-settings';

const ME: bigint = 1n;

describe('the account preferences pushed to the agent', () => {
  it('states every privacy choice as the user made it', async () => {
    const privacy: PrivacySettings = { ...DEFAULT_PRIVACY_SETTINGS, sendReadReceipts: false, acceptRequestsFromStrangers: false, notifyOnScreenshot: true };
    const prefs: AccountPreferences = await accountPreferences(ME, { privacy: () => privacy, retentionFor: async () => 'forever', levelFor: async () => 'Standard', peers: () => [] }, 'SenderOnly');
    expect(prefs).toEqual({
      send_read_receipts: false,
      accept_requests_from_strangers: false,
      notify_on_screenshot: true,
      notification_preview: 'SenderOnly',
      retention: [],
      security_minimums: [],
    });
  });

  it('passes the account\'s notification preview through untouched', async () => {
    const prefs: AccountPreferences = await accountPreferences(ME, { privacy: () => DEFAULT_PRIVACY_SETTINGS, retentionFor: async () => 'forever', levelFor: async () => 'Standard', peers: () => [] }, 'Text');
    expect(prefs.notification_preview).toBe('Text');
  });

  it('lists each chat that expires with its period, and leaves out the ones kept for ever', async () => {
    const periods: Map<bigint, Retention> = new Map<bigint, Retention>([[2n, 7], [3n, 'forever'], [4n, 365]]);
    const prefs: AccountPreferences = await accountPreferences(ME, {
      privacy: () => DEFAULT_PRIVACY_SETTINGS,
      retentionFor: async (_own: bigint, peer: bigint) => periods.get(peer) ?? 'forever',
      levelFor: async () => 'Standard',
      peers: () => [2n, 3n, 4n],
    }, 'SenderOnly');
    expect(prefs.retention).toEqual([
      { peer_cid: 2n, retention: { Days: 7 } },
      { peer_cid: 4n, retention: { Days: 365 } },
    ]);
  });

  // The agent declines an offer below these when it answers for the account with no window.
  it('lists each chat above Standard with its minimum level, and leaves out the Standard ones', async () => {
    const levels: Map<bigint, ChatSecurityLevel> = new Map<bigint, ChatSecurityLevel>([[2n, 'High'], [3n, 'Standard'], [4n, 'Extreme']]);
    const prefs: AccountPreferences = await accountPreferences(ME, {
      privacy: () => DEFAULT_PRIVACY_SETTINGS,
      retentionFor: async () => 'forever',
      levelFor: async (_own: bigint, peer: bigint) => levels.get(peer) ?? 'Standard',
      peers: () => [2n, 3n, 4n],
    }, 'SenderOnly');
    expect(prefs.security_minimums).toEqual([
      { peer_cid: 2n, level: 'High' },
      { peer_cid: 4n, level: 'Extreme' },
    ]);
  });

  it('names retention the way the agent does', () => {
    expect(toAgentRetention('forever')).toBe('Forever');
    expect(toAgentRetention(30)).toEqual({ Days: 30 });
  });
});
