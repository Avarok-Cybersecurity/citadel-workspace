/**
 * Sending to someone who has not accepted writes the message, holds it, and asks them nothing.
 *
 * The sender used to fire its own PeerRegister before every send to an unregistered peer --
 * a second request beside the connect banner's, which owns that request. Now it holds the
 * message (held-until-registered.ts) and leaves it pending, visible in the transcript.
 *
 * Real: MessageSender's send path and its status bookkeeping, the held outbox. Stood in, each
 * because it needs a live agent: the registry's answer (and its registerPeer, watched so a call
 * would show), auto-connect, the wire send, and the hold's wiring, here over an in-memory LocalDB.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';
import { HeldOutbox, type OutboxStorage } from '@/lib/p2p-pause/outbox';
import type { RegistrationHoldDeps } from '@/lib/p2p/held-until-registered';

const registerPeer: ReturnType<typeof vi.fn> = vi.fn();
const wireSend: ReturnType<typeof vi.fn> = vi.fn();
const rows: Map<string, number[]> = new Map();
const storage: OutboxStorage = {
  get: async (_c: bigint, k: string): Promise<{ value: number[] }> => {
    const v: number[] | undefined = rows.get(k);
    if (v === undefined) throw new Error(`Key not found: ${k}`);
    return { value: v };
  },
  set: async (_c: bigint, k: string, v: number[]): Promise<void> => { rows.set(k, v); },
  remove: async (_c: bigint, k: string): Promise<void> => { rows.delete(k); },
  listKeys: async (_c: bigint, p: string): Promise<string[]> => {
    const keys: string[] = [...rows.keys()].filter((k: string): boolean => k.startsWith(p));
    if (keys.length === 0) throw new Error(`No keys found with prefix ${p}`);
    return keys;
  },
};
const outbox: HeldOutbox = new HeldOutbox({ storage, now: (): number => Date.now() });

vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: { isPeerRegistered: (): boolean => false, registerPeer: (...a: unknown[]): unknown => registerPeer(...a) },
}));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: { isPeerConnected: async (): Promise<boolean> => false, ensurePeerConnectedInBackground: async (): Promise<undefined> => undefined },
}));
vi.mock('@/lib/p2p/message-send-operations', () => ({
  sendP2PCommand: (...a: unknown[]): unknown => wireSend(...a),
  sendRawMessage: async (): Promise<undefined> => undefined,
  sendMessageAck: async (): Promise<undefined> => undefined,
  sendRawBytes: async (): Promise<undefined> => undefined,
}));
vi.mock('@/lib/p2p/registration-hold', () => ({
  registrationHoldFor: (): RegistrationHoldDeps => ({
    outbox, isRegistered: (): boolean => false, send: wireSend,
    markSent: async (): Promise<void> => undefined, exclusive: <T,>(_n: string, t: () => Promise<T>): Promise<T> => t(),
  }),
}));

import { MessageSender } from '@/lib/p2p/message-sender';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';
import type { P2PMessage } from '@/lib/p2p/p2p-types';

const ME: bigint = 7n;
const BOB: bigint = 42n;

beforeAll(() => greetAs('older'));

describe('a send to someone who has not accepted', () => {
  it('is written pending and held, with no PeerRegister and nothing on the wire', async (): Promise<void> => {
    const statuses: P2PMessage['status'][] = [];
    const config: MessageSenderConfig = {
      getCurrentCid: async (): Promise<bigint> => ME,
      getOrCreateConversation: () => ({ peerCid: BOB, messages: [], lastMessageIndex: 0 }),
      addMessageToConversation: async (): Promise<boolean> => true,
      updateMessageInPages: async (): Promise<boolean> => true,
      emitEvent: (): void => undefined,
      notifyMessageListeners: (m: P2PMessage): void => { statuses.push(m.status); },
      notifyMessageStatusListeners: (_id: string, s: P2PMessage['status']): void => { statuses.push(s); },
      isConnected: (): boolean => false,
      tryEnsurePeerReady: async (): Promise<boolean> => false,
    } as unknown as MessageSenderConfig;

    const message: P2PMessage = await new MessageSender(config).sendMessage(BOB, 'hello before you accept');

    expect(message.status).toBe('pending');
    expect(statuses).toEqual(['pending']);
    expect(await outbox.heldCount(ME, BOB, 'unregistered')).toBe(1);
    expect(registerPeer).not.toHaveBeenCalled();
    expect(wireSend).not.toHaveBeenCalled();
  });
});
