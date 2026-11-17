/**
 * Everything this chat sends goes out at the chat's encryption level.
 *
 * Every send left the level unset, which the WASM binding reads as Standard,
 * so no per-chat level could reach a message. The level is now passed on every
 * send. (The UI cannot set one above Standard yet: the pinned SDK does not
 * honour it -- see ChatSettingsAdvanced.)
 *
 * Stood in: the agent socket. The send path and the settings store (over
 * jsdom's localStorage) are production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const OURS: bigint = 6001n;
const PEER: bigint = 6002n;

const sends: Array<{ peer: bigint; level: unknown }> = [];
vi.mock('../../websocket-service', () => ({
  websocketService: {
    ensureMessengerOpen: async (): Promise<boolean> => false,
    sendP2PMessageReliable: async (_cid: bigint, peer: bigint, _bytes: Uint8Array, level: unknown): Promise<void> => {
      sends.push({ peer, level });
    },
  },
}));

const { sendAllowingForAConcurrentOpen } = await import('../message-send-operations');
const { chatAdvancedSettings } = await import('../chat-advanced-settings');

describe('the level a chat message is sent at', () => {
  beforeEach((): void => { sends.length = 0; localStorage.clear(); });

  it('is the level this chat chose', async () => {
    await chatAdvancedSettings.set(OURS, PEER, { securityLevel: 'Extreme' });
    await sendAllowingForAConcurrentOpen(OURS, PEER, new Uint8Array([1]));
    expect(sends).toEqual([{ peer: PEER, level: 'Extreme' }]);
  });

  it('is Standard, stated, for a chat that chose nothing', async () => {
    await sendAllowingForAConcurrentOpen(OURS, PEER, new Uint8Array([1]));
    expect(sends).toEqual([{ peer: PEER, level: 'Standard' }]);
  });
});
