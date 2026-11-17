/**
 * A message that arrives and cannot be decoded or handled used to be a debug
 * line: the peer had sent something and the recipient got no sign of it. It now
 * leaves a plain system line in that conversation.
 *
 * Doubled: the conversation store (config.addMessageToConversation) and the
 * peer registry's name lookup. Decoding and dispatch run for real, on real bytes.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../p2p-registration-service', () => ({
  p2pRegistrationService: { getPeerInfo: (): { username: string } => ({ username: 'alice' }) },
}));

import { serializeP2PCommand } from '@/types/p2p-commands';
import { dispatchInboundCommand } from '../inbound-command-dispatch';
import type { P2PMessage } from '../p2p-types';
import type { MessageHandlerConfig } from '../message-handler-types';

interface World { stored: P2PMessage[]; notified: P2PMessage[]; config: MessageHandlerConfig }

function world(): World {
  const stored: P2PMessage[] = [];
  const notified: P2PMessage[] = [];
  const config: MessageHandlerConfig = {
    getCurrentCid: async (): Promise<bigint> => 100n,
    addMessageToConversation: async (_p: bigint, m: P2PMessage): Promise<boolean> => { stored.push(m); return true; },
    notifyMessageListeners: (m: P2PMessage): void => { notified.push(m); },
  } as unknown as MessageHandlerConfig;
  return { stored, notified, config };
}

describe('an inbound message that cannot be read', () => {
  it('leaves a system line naming the sender when its bytes do not decode', async () => {
    const w: World = world();
    await dispatchInboundCommand(new Uint8Array([0xff, 0xff, 0xff]), async (): Promise<void> => undefined, w.config, 42n);
    expect(w.stored).toHaveLength(1);
    expect(w.stored[0]).toMatchObject({ message_type: 'system_notice', senderCid: 42n, content: "A message from alice couldn't be read" });
    expect(w.notified).toEqual(w.stored);
  });

  it('leaves the line when decoding works but handling throws', async () => {
    const w: World = world();
    const bytes: Uint8Array = serializeP2PCommand({ type: 'typing', typing: true } as never);
    await dispatchInboundCommand(bytes, async (): Promise<void> => { throw new Error('storage timed out'); }, w.config, 42n);
    expect(w.stored).toHaveLength(1);
  });

  it('says nothing about a message that was handled', async () => {
    const w: World = world();
    await dispatchInboundCommand(serializeP2PCommand({ type: 'typing', typing: true } as never), async (): Promise<void> => undefined, w.config, 42n);
    expect(w.stored).toEqual([]);
  });
});
