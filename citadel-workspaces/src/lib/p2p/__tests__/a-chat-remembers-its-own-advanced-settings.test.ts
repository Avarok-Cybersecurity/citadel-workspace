/**
 * Each chat's Advanced settings are its own: one account, one peer.
 *
 * The Advanced tab offered "Encryption Level" and "Message Retention" with no
 * store behind them. This pins the store they now write, and the rules the
 * code that obeys them reads it by.
 *
 * The storage port is an in-memory map so a test can plant a record no
 * version of this code would write; production binds it to localStorage. The
 * store, its validation and its scoping are real.
 */
import { describe, it, expect } from 'vitest';
import {
  ChatAdvancedSettingsStore,
  DEFAULT_CHAT_ADVANCED_SETTINGS,
  type ChatAdvancedSettings,
  type ChatSettingsStorage,
} from '../chat-advanced-settings';

const ALICE: bigint = 11n;
const BOB: bigint = 22n;
const CAROL: bigint = 33n;

function memoryStorage(): ChatSettingsStorage & { raw: Map<string, unknown> } {
  const raw: Map<string, unknown> = new Map();
  return {
    raw,
    get: async (key: string): Promise<unknown> => raw.get(key),
    put: async (key: string, value: ChatAdvancedSettings): Promise<void> => { raw.set(key, value); },
  };
}

describe('per-chat advanced settings', () => {
  it('answers the documented defaults for a chat nothing was saved for', async () => {
    const store: ChatAdvancedSettingsStore = new ChatAdvancedSettingsStore(memoryStorage());
    expect(await store.get(ALICE, BOB)).toEqual(DEFAULT_CHAT_ADVANCED_SETTINGS);
    // Today's behaviour, stated: the lowest level and nothing deleted.
    expect(DEFAULT_CHAT_ADVANCED_SETTINGS).toEqual({ securityLevel: 'Standard', retention: 'forever' });
  });

  it('keeps what was saved, for that account and that peer only', async () => {
    const store: ChatAdvancedSettingsStore = new ChatAdvancedSettingsStore(memoryStorage());
    await store.set(ALICE, BOB, { securityLevel: 'High' });
    await store.set(ALICE, BOB, { retention: 30 });

    expect(await store.get(ALICE, BOB)).toEqual({ securityLevel: 'High', retention: 30 });
    expect(await store.get(ALICE, CAROL)).toEqual(DEFAULT_CHAT_ADVANCED_SETTINGS);
    // Another account in this browser talking to the same peer chose nothing.
    expect(await store.get(CAROL, BOB)).toEqual(DEFAULT_CHAT_ADVANCED_SETTINGS);
  });

  it('refuses a stored level it cannot keep rather than reading it as Standard', async () => {
    const storage: ChatSettingsStorage & { raw: Map<string, unknown> } = memoryStorage();
    const store: ChatAdvancedSettingsStore = new ChatAdvancedSettingsStore(storage);
    await store.set(ALICE, BOB, { securityLevel: 'Extreme', retention: 7 });
    const [key] = [...storage.raw.keys()];
    // 'Ultra' is a real SDK level, but the WASM message path does not parse it
    // and would send at Standard: it is not a level this chat can promise.
    storage.raw.set(key, { securityLevel: 'Ultra', retention: 7 });
    await expect(store.get(ALICE, BOB)).rejects.toThrow(/Ultra/);

    // Choosing again replaces the unreadable record.
    await store.set(ALICE, BOB, { securityLevel: 'High' });
    expect(await store.get(ALICE, BOB)).toEqual({ securityLevel: 'High', retention: 'forever' });
  });

  it('keeps everything when the stored retention period is unknown', async () => {
    const storage: ChatSettingsStorage & { raw: Map<string, unknown> } = memoryStorage();
    const store: ChatAdvancedSettingsStore = new ChatAdvancedSettingsStore(storage);
    await store.set(ALICE, BOB, { retention: 7 });
    const [key] = [...storage.raw.keys()];
    storage.raw.set(key, { securityLevel: 'High', retention: 12 });
    expect(await store.get(ALICE, BOB)).toEqual({ securityLevel: 'High', retention: 'forever' });
  });

  it('opens a same-browser pair at the higher of the two choices', async () => {
    // Both sessions live in this browser, and the leader opens the channel for
    // one of them. Opening at the lower choice would have the other refuse it.
    const store: ChatAdvancedSettingsStore = new ChatAdvancedSettingsStore(memoryStorage());
    await store.set(ALICE, BOB, { securityLevel: 'Reinforced' });
    await store.set(BOB, ALICE, { securityLevel: 'Extreme' });

    expect(await store.openingLevel(ALICE, BOB)).toBe('Extreme');
    expect(await store.openingLevel(BOB, ALICE)).toBe('Extreme');
    expect(await store.openingLevel(ALICE, CAROL)).toBe('Standard');
  });
});
