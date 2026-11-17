/**
 * Privacy settings have to reach the code that must obey them.
 *
 * All six lived inside PrivacySettingsTab, which wrote them to localStorage and
 * dispatched an event nothing subscribed to. No field was read anywhere outside
 * the tab that wrote it — so on a product built around the user controlling
 * their own data, "Send read receipts: off" still sent receipts.
 *
 * These assert at the send points, which is where the promise is kept or broken.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrivacySettings } from '@/lib/privacy-settings';
import { PresenceManager } from '@/lib/p2p/presence-manager';
import { markMessagesAsRead } from '@/lib/p2p/messenger-compatibility';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';
import {
  DEFAULT_PRIVACY_SETTINGS,
  PRIVACY_ENFORCEMENT,
  savePrivacySettings,
  getPrivacySettings,
} from '../privacy-settings';

// The page store's LocalDB, as a Map. Unanswered, marking read waited for the
// real socket to be built: a 2.5 s real-timer leader election, then a WASM load
// that cannot succeed here -- time the receipt decision does not depend on, and
// that a loaded runner stretched past the test timeout.
//
// The send points read the choice as the app gives it to them, through
// savePrivacySettings, so they are imported once rather than re-imported after
// a vi.resetModules() per test: every re-import is ~200 round trips to the
// vitest main process, which a loaded runner turned into seconds.
const disk: Map<string, string> = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendLocalDBGet: async (_cid: bigint, key: string): Promise<{ value: string }> => {
      const value: string | undefined = disk.get(key);
      if (value === undefined) throw new Error(`no such key: ${key}`);
      return { value };
    },
    sendLocalDBSet: async (_cid: bigint, key: string, value: number[]): Promise<void> => { disk.set(key, String.fromCharCode(...value)); },
    sendLocalDBDelete: async (_cid: bigint, key: string): Promise<void> => { disk.delete(key); },
    sendLocalDBListKeys: async (_cid: bigint, prefix: string): Promise<string[]> => [...disk.keys()].filter((k) => k.startsWith(prefix)),
  },
}));

beforeEach(() => {
  disk.clear();
  localStorage.clear();
  savePrivacySettings(DEFAULT_PRIVACY_SETTINGS);
});

describe('privacy settings storage', () => {
  it('keeps a saved choice and answers with it', () => {
    savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS, showOnlineStatus: false });
    expect(getPrivacySettings().showOnlineStatus).toBe(false);
  });

  it('fills in fields an older build never saved', async () => {
    // What a user who saved before these fields existed has on disk today.
    // `undefined` reads as "off" for a boolean, which would silently answer a
    // privacy question they were never asked. Same class as the file-transfer
    // settings merge.
    localStorage.setItem(
      'citadel:privacy-settings',
      JSON.stringify({ showOnlineStatus: false }),
    );
    // A fresh module instance, so nothing is cached from an earlier write.
    vi.resetModules();
    const fresh: typeof import('../privacy-settings') = await import('../privacy-settings');

    const read: PrivacySettings = fresh.getPrivacySettings();
    expect(read.showOnlineStatus).toBe(false);
    expect(read.sendReadReceipts).toBe(DEFAULT_PRIVACY_SETTINGS.sendReadReceipts);
    expect(read.acceptRequestsFromStrangers).toBe(DEFAULT_PRIVACY_SETTINGS.acceptRequestsFromStrangers);
  });

  it('does not start refusing strangers from a value nobody chose', async () => {
    // The old three-way select was disabled but saved on every visit to the
    // tab, so 'connections' sits in storage for users who never picked it.
    localStorage.setItem(
      'citadel:privacy-settings',
      JSON.stringify({ allowDirectMessages: 'connections', showProfileToStrangers: false }),
    );
    vi.resetModules();
    const fresh: typeof import('../privacy-settings') = await import('../privacy-settings');
    expect(fresh.getPrivacySettings().acceptRequestsFromStrangers).toBe(true);
  });

  it('is honest about which settings this build can act on', () => {
    // The three with a real send point to gate.
    expect(PRIVACY_ENFORCEMENT.showOnlineStatus).toBe(true);
    expect(PRIVACY_ENFORCEMENT.showTypingIndicators).toBe(true);
    expect(PRIVACY_ENFORCEMENT.sendReadReceipts).toBe(true);
    // Refused where the registration request is answered: this client.
    expect(PRIVACY_ENFORCEMENT.acceptRequestsFromStrangers).toBe(true);
    // Profile visibility is not a local setting at all: the server enforces it
    // (lib/profile-privacy.ts), so it has no entry here to claim anything.
    expect(Object.keys(PRIVACY_ENFORCEMENT)).not.toContain('showProfileToStrangers');
    // Best effort (PrintScreen on Windows/Linux only); the tab says so.
    expect(PRIVACY_ENFORCEMENT.notifyOnScreenshot).toBe(true);
  });
});

describe('typing indicators', () => {
  async function makeManager(showTypingIndicators: boolean): Promise<{ manager: PresenceManager; sendCommand: ReturnType<typeof vi.fn>; }> {
    savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS, showTypingIndicators });
    const sendCommand: ReturnType<typeof vi.fn> = vi.fn((): Promise<void> => Promise.resolve());
    const manager: PresenceManager = new PresenceManager({
      sendCommand,
      getConnectedPeers: () => [7n],
      isConnected: () => true,
    } as unknown as ConstructorParameters<typeof PresenceManager>[0]);
    return { manager, sendCommand };
  }

  it('sends one when the user allows it', async () => {
    const { manager, sendCommand } = await makeManager(true);
    await manager.sendTypingIndicator(7n);
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the user turned them off', async () => {
    const { manager, sendCommand } = await makeManager(false);
    await manager.sendTypingIndicator(7n);
    expect(sendCommand).not.toHaveBeenCalled();
  });
});

describe('read receipts', () => {
  /**
   * The local half of "read" must happen either way — the user did read the
   * message, so their unread badge has to clear. Only the ack, the part that
   * tells the sender, is theirs to withhold.
   */
  async function markRead(sendReadReceipts: boolean): Promise<{ sendMessageAck: ReturnType<typeof vi.fn>; message: { id: string; senderCid: bigint; status: "delivered"; }; conversation: { messages: { id: string; senderCid: bigint; status: "delivered"; }[]; unreadCount: number; }; }> {
    savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS, sendReadReceipts });
    await greetAs('older');

    const message: { id: string; senderCid: bigint; status: "delivered"; } = { id: 'm1', senderCid: 7n, status: 'delivered' as const };
    const conversation: { messages: { id: string; senderCid: bigint; status: "delivered"; }[]; unreadCount: number; } = { messages: [message], unreadCount: 1 };
    const conversationManager: { getConversation: () => { messages: { id: string; senderCid: bigint; status: "delivered"; }[]; unreadCount: number; }; } = { getConversation: (): { messages: { id: string; senderCid: bigint; status: "delivered"; }[]; unreadCount: number; } => conversation };
    const sendMessageAck: ReturnType<typeof vi.fn> = vi.fn((): Promise<void> => Promise.resolve());

    await markMessagesAsRead(
      conversationManager as never,
      sendMessageAck,
      vi.fn(),
      7n,
    );
    return { sendMessageAck, message, conversation };
  }

  it('tells the sender when the user allows it', async () => {
    const { sendMessageAck, message } = await markRead(true);
    expect(sendMessageAck).toHaveBeenCalledWith('m1', 'read', 7n);
    expect(message.status).toBe('read');
  });

  it('marks read locally but tells the sender nothing when declined', async () => {
    const { sendMessageAck, message, conversation } = await markRead(false);
    expect(sendMessageAck).not.toHaveBeenCalled();
    // The user's own view still updates — withholding the receipt must not cost
    // them their own unread badge.
    expect(message.status).toBe('read');
    expect(conversation.unreadCount).toBe(0);
  });
});
