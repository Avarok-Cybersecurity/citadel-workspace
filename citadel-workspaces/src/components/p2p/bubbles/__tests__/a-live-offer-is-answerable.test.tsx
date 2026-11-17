/**
 * Seen live: a file offer arrived in the recipient's open DM and rendered at
 * once as "Offer expired — ask the sender to send it again", with no Accept.
 *
 * The bubble calls an offer with no service record "restored" -- unanswerable
 * -- unless the service marked it as arriving during this page's life. That
 * mark and the record are written by FileTransferService's listener for
 * `p2p:file-transfer-message`. The listener lives in the service module, which
 * the build puts in a chunk only the page components import; the inbound P2P
 * router that EMITS the event is in `app-services-deferred`, which index loads
 * on its own. An offer routed before the service module was evaluated was
 * emitted to nobody: no mark, no record, and the protocol half's join never
 * made either -- a live offer rendered as a dead one.
 *
 * Replayed here in the receiver's real order: the sender's announcement,
 * encoded and decoded as the wire does, through the real inbound router and
 * the real FileTransferMessageHandler, with the service module NOT yet
 * imported -- then the bubble renders the entry the handler stored. Mocked:
 * the socket, the tab's session lookup (IndexedDB) and the auto-connect
 * service (a network singleton the router pings).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

vi.mock('@/lib/tab-context', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 7n }),
}));
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: async (): Promise<void> => undefined,
    sendP2PMessageReliable: async (): Promise<void> => undefined,
    ensureMessengerOpen: async (): Promise<boolean> => false,
    canSendRequests: (): boolean => false,
  },
}));
vi.mock('@/lib/p2p-auto-connect-service', () => ({
  p2pAutoConnectService: {
    markChannelReady: (): void => {},
    waitForPeerConnected: async (): Promise<boolean> => true,
  },
}));

import type { P2PMessage } from '@/lib/p2p';
import type { FileTransfer } from '@/lib/file-transfer/types';

// Fetched and transformed now, at collection, which no test timeout measures;
// cold, that was the first test's 1.1 s. These instances are discarded: each
// test's vi.resetModules() gives it a fresh graph, an unloaded service and a new
// event emitter, so the order this file replays is unchanged.
import '@/lib/file-transfer/transfer-announcement';
import '@/lib/p2p/message-handler-routing';
import '@/lib/p2p/file-transfer-message-handler';
import '@/lib/file-transfer';
import '../FileTransferBubble';

afterEach(cleanup);
beforeEach((): void => { vi.resetModules(); });

const BOB: bigint = 7n;
const ALICE: bigint = 42n;
const settle = (): Promise<void> => act(async (): Promise<void> => { await new Promise((r) => setTimeout(r, 0)); });

/** The sender's announcement, over the wire, into the receiver's inbound router. */
async function receiveOffer(transferId: string): Promise<P2PMessage> {
  const { buildTransferAnnouncement } = await import('@/lib/file-transfer/transfer-announcement');
  const { createMessagingLayerCommand, serializeP2PCommand, deserializeP2PCommand } = await import('@/types/p2p-commands');
  const { handleMessagingLayerCommand } = await import('@/lib/p2p/message-handler-routing');
  const { FileTransferMessageHandler } = await import('@/lib/p2p/file-transfer-message-handler');
  const outgoing: FileTransfer = {
    id: transferId, fileName: 'x.txt', fileSize: 3, fileType: 'text/plain', state: 'pending', progress: 0,
    senderCid: ALICE.toString(), recipientCid: BOB.toString(), createdAt: Date.now(), updatedAt: Date.now(),
    expiresAt: Date.now() + 60_000, isIncoming: false,
  };
  const layer: unknown = buildTransferAnnouncement(outgoing).layer;
  const command: ReturnType<typeof deserializeP2PCommand> = deserializeP2PCommand(
    serializeP2PCommand(createMessagingLayerCommand(layer as never, ALICE, BOB, 0)),
  );
  const entries: P2PMessage[] = [];
  const handler: InstanceType<typeof FileTransferMessageHandler> = new FileTransferMessageHandler({
    getOrCreateConversation: () => ({}) as never,
    notifyMessageListeners: (): void => {},
    sendMessageAck: async (): Promise<void> => {},
    addMessageToConversation: async (_p: bigint, m: P2PMessage): Promise<boolean> => { entries.push(m); return true; },
  });
  const config: Record<string, unknown> = { getCurrentCid: async (): Promise<bigint> => BOB, markPeerReady: (): void => {} };
  await handleMessagingLayerCommand(config as never, handler, command.payload as never, ALICE, BOB);
  await settle();
  return entries[0];
}

async function bubbleState(entry: P2PMessage): Promise<string | null> {
  const { FileTransferBubble } = await import('../FileTransferBubble');
  render(<FileTransferBubble message={entry} isOwn={false} onAccept={(): void => undefined} />);
  return screen.getByTestId('file-transfer-bubble').getAttribute('data-transfer-state');
}

describe('an offer that arrives while the page is open', () => {
  it('can be answered even if it is routed before the file-transfer service was loaded', async () => {
    const entry: P2PMessage = await receiveOffer('live-1');
    expect(entry?.transfer_id).toBe('live-1');
    const { fileTransferService } = await import('@/lib/file-transfer');
    expect(fileTransferService.getTransfer('live-1')?.state, 'the service never recorded the offer').toBe('pending');
    expect(await bubbleState(entry)).toBe('pending');
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeTruthy();
  });

  it('can be answered when the service was already loaded', async () => {
    await import('@/lib/file-transfer');
    const entry: P2PMessage = await receiveOffer('live-2');
    expect(await bubbleState(entry)).toBe('pending');
  });
});
