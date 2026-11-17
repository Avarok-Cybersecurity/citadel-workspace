/**
 * Screenshot alerts, best effort.
 *
 * A web page sees exactly one screenshot signal: the PrintScreen key reaching
 * it, which happens on Windows and Linux. macOS's Cmd+Shift+3/4/5, phone
 * screenshots, the Snipping Tool's own shortcut and any external capture never
 * reach the page. So the detector recognises that key and nothing else, and
 * the setting's copy says so rather than promising more.
 *
 * The receiver shows the notice as a system line only when THEY asked to be
 * told ("Get notified if someone takes a screenshot").
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: { markChannelReady: (): void => {} },
}));

import { isScreenshotKey, SCREENSHOT_ALERT_LIMITS } from '../screenshot-detection';
import { applyScreenshotNotice } from '../inbound-screenshot-notice';
import { handleMessagingLayerCommand } from '../message-handler-routing';
import { createScreenshotNotice } from '@/types/screenshot-notice-layer';
import { savePrivacySettings, DEFAULT_PRIVACY_SETTINGS } from '@/lib/privacy-settings';
import type { P2PMessage } from '../p2p-types';
import type { P2PMessagingLayerPayload } from '@/types/p2p-types';
import type { MessageHandlerConfig } from '../message-handler-types';
import type { FileTransferMessageHandler } from '../file-transfer-message-handler';

describe('what counts as a screenshot', () => {
  it('is the PrintScreen key', () => {
    expect(isScreenshotKey({ key: 'PrintScreen', code: 'PrintScreen' })).toBe(true);
    expect(isScreenshotKey({ key: 'Unidentified', code: 'PrintScreen' })).toBe(true);
  });

  it('is not an ordinary key, nor the macOS shortcut a page never truly sees', () => {
    expect(isScreenshotKey({ key: 's', code: 'KeyS' })).toBe(false);
    expect(isScreenshotKey({ key: '3', code: 'Digit3' })).toBe(false);
  });

  it('states its limits plainly', () => {
    expect(SCREENSHOT_ALERT_LIMITS).toMatch(/Best effort/);
    expect(SCREENSHOT_ALERT_LIMITS).toMatch(/PrintScreen/);
    expect(SCREENSHOT_ALERT_LIMITS).toMatch(/macOS/);
    expect(SCREENSHOT_ALERT_LIMITS).toMatch(/phone/);
  });
});

function recorder(): { stored: P2PMessage[]; notified: P2PMessage[]; config: MessageHandlerConfig } {
  const stored: P2PMessage[] = [];
  const notified: P2PMessage[] = [];
  const config: MessageHandlerConfig = {
    addMessageToConversation: async (_peer: bigint, m: P2PMessage): Promise<boolean> => { stored.push(m); return true; },
    notifyMessageListeners: (m: P2PMessage): void => { notified.push(m); },
    markPeerReady: (): void => {},
  } as unknown as MessageHandlerConfig;
  return { stored, notified, config };
}

const PAYLOAD: P2PMessagingLayerPayload = {
  layer: createScreenshotNotice(1_700_000_000_000),
  sender_cid: 42n, recipient_cid: 7n, message_id: 'shot-1', index: 3,
};

describe('a screenshot notice from the peer', () => {
  it('becomes a system line naming them, when the user asked to be told', async () => {
    const { stored, notified, config } = recorder();
    await applyScreenshotNotice(config, PAYLOAD, 42n, { notify: true, peerName: 'Bob' });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: 'shot-1', message_type: 'system_notice', senderCid: 42n, recipientCid: 7n,
      content: 'Bob may have taken a screenshot',
    });
    expect(notified).toEqual(stored);
  });

  it('is dropped when the user did not ask to be told', async () => {
    const { stored, notified, config } = recorder();
    await applyScreenshotNotice(config, PAYLOAD, 42n, { notify: false, peerName: 'Bob' });
    expect(stored).toEqual([]);
    expect(notified).toEqual([]);
  });

  it('reaches that handler from the inbound router, under the saved setting', async () => {
    // Without this the two above pass while the router's default arm drops
    // every notice as an unknown layer type.
    savePrivacySettings({ ...DEFAULT_PRIVACY_SETTINGS, notifyOnScreenshot: true });
    const { stored, config } = recorder();
    await handleMessagingLayerCommand(config, {} as FileTransferMessageHandler, PAYLOAD, 42n, 7n);
    expect(stored.map((m: P2PMessage) => m.message_type)).toEqual(['system_notice']);
  });
});
