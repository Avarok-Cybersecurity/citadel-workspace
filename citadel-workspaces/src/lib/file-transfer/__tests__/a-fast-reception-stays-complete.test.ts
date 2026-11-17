/**
 * A file small enough to land before the accept call returns must stay landed.
 *
 * Seen live: bob accepted a 3000-byte P2P file; alice's bubble reached "Sent
 * successfully" half a second later; bob's stayed on "Downloading... 100%" for
 * minutes, his Files list stayed empty, and the file sat byte-identical in the
 * agent's data dir.
 *
 * The agent's order for an accepted reception (respond_file_transfer.rs spawns
 * the tick updater, kernel/mod.rs `spawn_tick_updater` stamps every tick with
 * the RespondFileTransfer request_id, cid = us, peer_cid = sender):
 *
 *   FileTransferTickNotification { status: ReceptionBeginning(path, metadata) }
 *   FileTransferTickNotification { status: ReceptionTick(g, total, rate) }  (none for a one-group file)
 *   FileTransferTickNotification { status: "ReceptionComplete" }
 *   FileTransferStatusNotification { success: true, response: true }  (the request's answer)
 *
 * All of that can arrive while `acceptTransfer` is still awaiting the in-band
 * accept signal to the sender, which is a P2P round trip. The completion was
 * applied — progress 100 — and then acceptTransfer resumed and wrote
 * 'transferring' over it. 'complete' is terminal, so nothing ever corrected it.
 *
 * Driven through the real service, router and parser. Mocked: the socket to the
 * agent (an I/O boundary; the agent's frames are replayed from the Rust source
 * above) and the tab's session lookup (IndexedDB).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/tab-context', () => ({
  getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 7n }),
}));

const sendRequest: ReturnType<typeof vi.fn> = vi.fn(async (_request: unknown): Promise<void> => undefined);
const sendP2PMessageReliable: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => undefined);
vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendRequest: (r: unknown): Promise<void> => sendRequest(r),
    sendP2PMessageReliable: (): Promise<void> => sendP2PMessageReliable(),
    // In-band signals open this session's messenger first; see in-band-signals.
    ensureMessengerOpen: async (): Promise<boolean> => false,
    // Read by the messenger the bubble updates go through; no socket here.
    canSendRequests: (): boolean => false,
  },
}));

import { eventEmitter } from '@/lib/event-emitter';
import { fileTransferService } from '../service';
import { FILE_TRANSFER_EVENTS } from '../events';
import { MessagingLayerType } from '@/types/messaging-layer';
import type { FileTransfer } from '../types';
import type { VirtualObjectMetadata } from '../protocol-types';
import { FileTransferState } from '../state';
import { cancelTransfer, type LifecycleDeps } from '../transfer-lifecycle';
import { applyTransferOutcome } from '../transfer-outcome';
import { ONLINE_PEER_QUEUE } from './online-peer-queue';

const BOB: bigint = 7n;
const ALICE: bigint = 42n;
const TRANSFER_ID: string = '6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8';
const OBJECT_ID: bigint = 90210n;
const DOWNLOAD_PATH: string = '/data/transfers/42/live-xfer-0924.bin';

const metadata: VirtualObjectMetadata = {
  name: 'live-xfer-0924.bin', date_created: '', author: 'alice',
  plaintext_length: 3000, group_count: 1, object_id: OBJECT_ID, cid: ALICE,
  transfer_type: 'FileTransfer',
} as VirtualObjectMetadata;

function frame(message: Record<string, unknown>): void {
  eventEmitter.emit('websocket-message', message);
}

function tick(requestId: string, status: unknown): void {
  frame({ FileTransferTickNotification: { cid: BOB, peer_cid: ALICE, request_id: requestId, status } });
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('a reception that completes during the accept round trip', () => {
  it('stays complete, and the last state the bubble is told is complete', async () => {
    const told: string[] = [];
    eventEmitter.on(FILE_TRANSFER_EVENTS.STATE_CHANGED, (t: FileTransfer) => {
      if (t.id === TRANSFER_ID) told.push(t.state);
    });

    // The offer's two halves: the in-band announcement, then the protocol offer.
    eventEmitter.emit('p2p:file-transfer-message', {
      layer: {
        type: MessagingLayerType.FileTransferRequest, transfer_id: TRANSFER_ID,
        file_name: metadata.name, file_size: 3000, file_type: 'application/octet-stream',
        transfer_mode: 'p2p', timestamp: Date.now(), expiry_timestamp: Date.now() + 60_000,
      },
      senderCid: ALICE.toString(),
      recipientCid: BOB.toString(),
    });
    frame({ FileTransferRequestNotification: { cid: BOB, peer_cid: ALICE, metadata, request_id: null } });
    await settle();
    expect(fileTransferService.getTransfer(TRANSFER_ID)?.state).toBe('pending');

    // The whole reception lands while the in-band accept signal is in flight.
    sendP2PMessageReliable.mockImplementationOnce(async (): Promise<void> => {
      const respond: { RespondFileTransfer: { request_id: string } } =
        sendRequest.mock.calls.at(-1)?.[0] as { RespondFileTransfer: { request_id: string } };
      const requestId: string = respond.RespondFileTransfer.request_id;
      tick(requestId, { ReceptionBeginning: [DOWNLOAD_PATH, metadata] });
      tick(requestId, 'ReceptionComplete');
      frame({
        FileTransferStatusNotification: {
          cid: BOB, object_id: OBJECT_ID, success: true, response: true, message: null, request_id: requestId,
        },
      });
      await settle();
    });

    await fileTransferService.acceptTransfer(TRANSFER_ID);
    await settle();

    const landed: FileTransfer | undefined = fileTransferService.getTransfer(TRANSFER_ID);
    expect(landed?.state, 'accept resumed and wrote transferring over the completion').toBe('complete');
    expect(landed?.downloadPath).toBe(DOWNLOAD_PATH);
    expect(told.at(-1), 'the bubble was last told a non-final state').toBe('complete');
  });
});

describe('a send that completes during the cancel signal', () => {
  it('keeps its completion rather than being rewritten as cancelled', async () => {
    const state: FileTransferState = new FileTransferState();
    const outgoing: FileTransfer = {
      id: 'out-1', fileName: 'a.bin', fileSize: 3000, fileType: '',       state: 'transferring', progress: 0, senderCid: '7', recipientCid: '42',
      createdAt: 0, updatedAt: 0, isIncoming: false,
    };
    state.setTransfer(outgoing);
    const deps: LifecycleDeps = {
      state,
      // The I/O port: the cancel signal's round trip, inside which the
      // protocol plane's TransferComplete is applied.
      io: {
        executeIntent: async (): Promise<void> => {
          await applyTransferOutcome(deps, 'out-1', { success: true });
        },
      } as unknown as LifecycleDeps['io'],
      emitStateChange: (): void => undefined,
      saveTransfer: async (): Promise<void> => undefined,
      saveSettings: async (): Promise<void> => undefined,
      // Cancel never opens a channel; present because the port requires it.
      openPeerChannel: async (): Promise<boolean> => true,
      // An agent that does not stage uploads: the inline route, 16 MB.
      agentStagesUploads: async (): Promise<boolean> => false,
      queue: ONLINE_PEER_QUEUE,
    };

    await cancelTransfer(deps, 'out-1');

    expect(state.getTransfer('out-1')?.state).toBe('complete');
  });
});
