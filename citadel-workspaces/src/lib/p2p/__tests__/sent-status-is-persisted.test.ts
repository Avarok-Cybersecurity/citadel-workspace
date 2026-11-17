/**
 * A message's terminal send status must survive a reload.
 *
 * Both send paths mutated `message.status` in memory only. The row was
 * persisted while still `'pending'`, so that is the row read back — every
 * message the user had ever sent rendered a "sending…" clock after a reload.
 * Worse, the retry affordance is gated on `'failed'`, so a message that
 * genuinely failed could never be retried: it looked like it was still on its
 * way, forever, with no path by which it would ever be sent.
 *
 * `resendMessage` did call `updateMessageInPages` — but only after a `catch`
 * that rethrows, so it too recorded 'sent' and never 'failed'. The one status
 * worth keeping was the one guaranteed to be lost.
 *
 * These assert on what reaches the PAGE STORE, not on the in-memory object. The
 * in-memory object was always correct, which is exactly why this was invisible.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { greetAs } from '@/lib/agent-conversations/__tests__/agent-greeting';

const wireSend: ReturnType<typeof vi.fn> = vi.fn();

// Mock only the wire call and the fire-and-forget background connect. Everything
// between them — including the status bookkeeping under test — stays real.
vi.mock('@/lib/p2p/message-send-operations', () => ({
  sendP2PCommand: (_config: unknown, peerCid: bigint, command: unknown): unknown => wireSend(peerCid, command),
  sendRawMessage: async (): Promise<undefined> => undefined,
  sendMessageAck: async (): Promise<undefined> => undefined,
  sendRawBytes: async (): Promise<undefined> => undefined,
}));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    isPeerConnected: async (): Promise<boolean> => true,
    ensurePeerConnectedInBackground: async (): Promise<undefined> => undefined,
  },
}));

import { MessageSender } from '@/lib/p2p/message-sender';
import type { MessageSenderConfig } from '@/lib/p2p/message-sender-types';
import type { P2PMessage } from '@/lib/p2p/p2p-types';

const PEER: bigint = 42n;

/** Captures exactly what would be written to storage. */
function makeConfig(): { config: MessageSenderConfig; persisted: { id: string; updates: Partial<P2PMessage>; }[]; } {
  const persisted: Array<{ id: string; updates: Partial<P2PMessage> }> = [];
  const config: MessageSenderConfig = {
    getCurrentCid: async () => 7n,
    getOrCreateConversation: () => ({ peerCid: PEER, messages: [] }),
    addMessageToConversation: async () => true,
    updateMessageInPages: async (_peer: bigint, id: string, updates: Partial<P2PMessage>) => {
      persisted.push({ id, updates });
      return true;
    },
    emitEvent: () => {},
    notifyMessageListeners: () => {},
    notifyMessageStatusListeners: () => {},
    isConnected: () => true,
    tryEnsurePeerReady: async () => true,
  } as unknown as MessageSenderConfig;
  return { config, persisted };
}

async function sendAndCatch(config: MessageSenderConfig): Promise<string> {
  try {
    await new MessageSender(config).sendMessage(PEER, 'hello');
    return 'NO_ERROR';
  } catch (e) {
    return (e as Error).message;
  }
}


// The browser-written store is the path for an agent before 0.8.6; this tab's socket greeted one.
beforeAll(() => greetAs('older'));
describe('terminal send status', () => {
  it('is written through when the send succeeds', async () => {
    wireSend.mockImplementation(async () => undefined);
    const { config, persisted } = makeConfig();

    expect(await sendAndCatch(config)).toBe('NO_ERROR');

    expect(persisted.length, 'nothing was persisted').toBeGreaterThan(0);
    expect(persisted[persisted.length - 1]?.updates.status).toBe('sent');
  });

  it('is written through when the send fails, before the error propagates', async () => {
    wireSend.mockImplementation(async () => {
      throw new Error('peer unreachable');
    });
    const { config, persisted } = makeConfig();

    expect(await sendAndCatch(config)).toBe('peer unreachable');

    // The failed status is what makes the message retryable after a reload,
    // and it was the one the rethrow guaranteed to lose.
    expect(persisted.length, 'the failure was never persisted').toBeGreaterThan(0);
    expect(persisted[persisted.length - 1]?.updates.status).toBe('failed');
    expect(persisted[persisted.length - 1]?.updates.error).toBe('peer unreachable');
  });

  it('does not let a storage failure mask the send error', async () => {
    wireSend.mockImplementation(async () => {
      throw new Error('peer unreachable');
    });
    const { config } = makeConfig();
    config.updateMessageInPages = async (): Promise<never> => {
      throw new Error('quota exceeded');
    };

    // The user needs to see why the message did not send, not why its status
    // could not be written.
    expect(await sendAndCatch(config)).toBe('peer unreachable');
  });
});
