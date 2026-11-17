/**
 * The receiving end of the wiring, production code throughout: the message handler hands a
 * CdocChatSync command on as `cdoc:chat-command` (it never reaches cdoc itself), and the app's
 * chat transport delivers it only to the document's own session with its own peer. A command
 * the envelope guard refuses goes nowhere.
 */
import { describe, expect, it } from 'vitest';
import { deserializeP2PCommand, type P2PCommand } from '@/types/p2p-commands';
import type { CdocChatSyncPayload } from '@/types/cdoc-chat-sync';
import { MessageHandler } from '@/lib/p2p/message-handler';
import type { MessageHandlerConfig } from '@/lib/p2p/message-handler-types';
import { CHAT_SYNC } from '../chat-config';
import { p2pChatTransport } from '../chat-app-ports';
import { encodeChatSync } from '../chat-wire';
import type { ChatTransport } from '../chat-ports';

const ALICE: bigint = 501n;
const BOB: bigint = 502n;
const CAROL: bigint = 503n;

// The CdocChatSync branch reads none of the handler's stores; the config is never called.
const UNUSED: MessageHandlerConfig = {} as MessageHandlerConfig;

const payload: CdocChatSyncPayload = { doc_id: 'doc-a', doc_version: CHAT_SYNC.docVersion, sync: { kind: 'awareness', record: new Uint8Array([9, 8]) } };
const onWire = (p: CdocChatSyncPayload): P2PCommand => deserializeP2PCommand(encodeChatSync(p));

describe('a CdocChatSync command received', () => {
  it('reaches the transport of the session it is addressed to, from its own peer only', async () => {
    const handler: MessageHandler = new MessageHandler(UNUSED);
    const alicesWithBob: ChatTransport = p2pChatTransport(ALICE, BOB);
    const heard: CdocChatSyncPayload[] = [];
    const off: () => void = alicesWithBob.onMessage((p: CdocChatSyncPayload): void => { heard.push(p); });
    await handler.handleP2PCommand(onWire(payload), BOB, ALICE);
    await handler.handleP2PCommand(onWire(payload), CAROL, ALICE);
    await handler.handleP2PCommand(onWire(payload), BOB, CAROL);
    off();
    expect(heard.length).toBe(1);
    expect(heard[0].doc_id).toBe('doc-a');
    expect(Array.from((heard[0].sync as { record: Uint8Array }).record)).toEqual([9, 8]);
  });

  it('goes nowhere when its envelope is not one', async () => {
    const handler: MessageHandler = new MessageHandler(UNUSED);
    const heard: CdocChatSyncPayload[] = [];
    const off: () => void = p2pChatTransport(ALICE, BOB).onMessage((p: CdocChatSyncPayload): void => { heard.push(p); });
    const bad: P2PCommand = onWire({ ...payload, sync: { kind: 'nonsense' } as unknown as CdocChatSyncPayload['sync'] });
    await handler.handleP2PCommand(bad, BOB, ALICE);
    off();
    expect(heard).toEqual([]);
  });
});
