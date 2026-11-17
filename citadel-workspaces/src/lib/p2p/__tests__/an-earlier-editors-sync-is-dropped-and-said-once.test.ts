/**
 * A peer still on an earlier version sends the earlier chat editor's YjsP2PSync. Nothing here
 * reads it any more (chat documents are Citadel Docs documents, kept in step by CdocChatSync):
 * it is dropped without a crash and without reaching any listener, and the conversation says
 * so once per peer, never once per update.
 *
 * Doubled: the conversation store (config.addMessageToConversation) and the peer registry's
 * name lookup. The command crosses the real CBOR envelope and the real message handler.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../p2p-registration-service', () => ({
  p2pRegistrationService: { getPeerInfo: (cid: bigint): { username: string } => ({ username: cid === 7n ? 'alice' : 'bob' }) },
}));

import { deserializeP2PCommand, serializeP2PCommand, P2PCommandType, type P2PCommand } from '@/types/p2p-commands';
import { eventEmitter } from '@/lib/event-emitter';
import { MessageHandler } from '../message-handler';
import type { P2PMessage } from '../p2p-types';
import type { MessageHandlerConfig } from '../message-handler-types';

const ALICE: bigint = 7n;
const BOB: bigint = 8n;

const earlierSync = (n: number): P2PCommand => deserializeP2PCommand(serializeP2PCommand({
  type: P2PCommandType.YjsP2PSync,
  payload: { type: 'yjs_sync', document_id: 'doc-1', update: [1, 2, n] },
}));

interface World {
  readonly stored: P2PMessage[];
  readonly handler: MessageHandler;
}

function world(): World {
  const stored: P2PMessage[] = [];
  const config: MessageHandlerConfig = {
    getCurrentCid: async (): Promise<bigint> => 100n,
    addMessageToConversation: async (_peer: bigint, message: P2PMessage): Promise<boolean> => { stored.push(message); return true; },
    notifyMessageListeners: (): void => undefined,
  } as unknown as MessageHandlerConfig;
  return { stored, handler: new MessageHandler(config) };
}

describe('the earlier chat editor’s sync, received', () => {
  it('is dropped, reaching no listener, and the conversation says so once per peer', async () => {
    const { stored, handler }: World = world();
    const heard: unknown[] = [];
    const off: () => void = eventEmitter.on('yjs:p2p-command', (event: unknown): void => { heard.push(event); });
    for (let n: number = 0; n < 5; n += 1) await handler.handleP2PCommand(earlierSync(n), ALICE, 100n);
    await handler.handleP2PCommand(earlierSync(9), BOB, 100n);
    off();
    expect(heard).toEqual([]);
    expect(stored.map((m: P2PMessage): [bigint, string, string] => [m.senderCid, m.message_type ?? '', m.content])).toEqual([
      [ALICE, 'system_notice', 'alice is editing a chat document in an earlier version of the app. Their changes can\'t reach you until they update.'],
      [BOB, 'system_notice', 'bob is editing a chat document in an earlier version of the app. Their changes can\'t reach you until they update.'],
    ]);
  });

  it('says so again later when the line could not be written the first time', async () => {
    const stored: P2PMessage[] = [];
    let failNext: boolean = true;
    const config: MessageHandlerConfig = {
      getCurrentCid: async (): Promise<bigint> => 100n,
      addMessageToConversation: async (_peer: bigint, message: P2PMessage): Promise<boolean> => {
        if (failNext) { failNext = false; throw new Error('LocalDB request timed out'); }
        stored.push(message);
        return true;
      },
      notifyMessageListeners: (): void => undefined,
    } as unknown as MessageHandlerConfig;
    const handler: MessageHandler = new MessageHandler(config);
    await handler.handleP2PCommand(earlierSync(1), ALICE, 100n);
    await handler.handleP2PCommand(earlierSync(2), ALICE, 100n);
    expect(stored).toHaveLength(1);
  });
});
