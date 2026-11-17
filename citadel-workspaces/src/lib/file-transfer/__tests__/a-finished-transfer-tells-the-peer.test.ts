/**
 * Each side says when a transfer finished on its side, because the other side's
 * page may have reloaded across the last tick: the agent drops a tick nobody is
 * attached for (tick_updater.rs), so that page never heard the protocol's own
 * completion. A recipient attached all along does not take the sender's word:
 * its own ReceptionComplete carries where the file was saved.
 *
 * Real: the protocol-event and peer-signal handlers and the outcome guard.
 * Doubled: the agent (executeIntent).
 */
import { describe, it, expect } from 'vitest';
import { MessagingLayerType } from '@/types/messaging-layer';
import { handleProtocolComplete } from '../protocol-transfer-events';
import { handlePeerComplete } from '../peer-signals';
import { FileTransferState } from '../state';
import type { P2PTransferDeps } from '../p2p-transfers';
import type { FileTransfer } from '../types';

function setup(transfer: FileTransfer): { deps: P2PTransferDeps; intents: Array<Record<string, unknown>> } {
  const state: FileTransferState = new FileTransferState();
  state.setTransfer(transfer);
  const intents: Array<Record<string, unknown>> = [];
  const deps: P2PTransferDeps = {
    state,
    io: { executeIntent: async (intent: Record<string, unknown>): Promise<void> => { intents.push(intent); } },
    emitStateChange: (): void => undefined,
    saveTransfer: async (): Promise<void> => undefined,
  } as unknown as P2PTransferDeps;
  return { deps, intents };
}

const incoming = (over: Partial<FileTransfer> = {}): FileTransfer => ({
  id: 'r-1', fileName: 'photo.jpg', fileSize: 10, fileType: 'image/jpeg', state: 'transferring', progress: 50,
  senderCid: '42', recipientCid: '7', createdAt: 1, updatedAt: 1, isIncoming: true, ...over,
});
const complete = (id: string): { type: MessagingLayerType.FileTransferComplete; transfer_id: string; success: boolean; timestamp: number } =>
  ({ type: MessagingLayerType.FileTransferComplete, transfer_id: id, success: true, timestamp: 1 });

describe('a transfer that finishes here', () => {
  it('tells the peer', async () => {
    const { deps, intents } = setup(incoming());
    await handleProtocolComplete(deps, { transferId: 'r-1', cid: 7n, peerCid: 42n, direction: 'incoming', success: true, downloadPath: '/d/photo.jpg' });
    expect(intents).toEqual([{ type: 'send-complete', transferId: 'r-1', targetCid: 42n }]);
  });

  it('says nothing more when it was already over', async () => {
    const { deps, intents } = setup(incoming({ state: 'complete' }));
    await handleProtocolComplete(deps, { transferId: 'r-1', cid: 7n, peerCid: 42n, direction: 'incoming', success: true });
    expect(intents).toEqual([]);
  });
});

describe('the peer saying it finished', () => {
  it('finishes a send whose own last tick this page missed', async () => {
    const { deps } = setup({ ...incoming(), id: 's-1', isIncoming: false, senderCid: '7', recipientCid: '42' });
    await handlePeerComplete(deps, complete('s-1'));
    expect(deps.state.getTransfer('s-1')?.state).toBe('complete');
  });

  it('finishes a reception picked up after a reload, keeping where it is saved', async () => {
    const { deps } = setup(incoming({ resuming: true, downloadPath: '/d/photo.jpg' }));
    await handlePeerComplete(deps, complete('r-1'));
    expect(deps.state.getTransfer('r-1')).toMatchObject({ state: 'complete', downloadPath: '/d/photo.jpg' });
  });

  it('does not finish a reception this page has followed all along', async () => {
    const { deps } = setup(incoming());
    await handlePeerComplete(deps, complete('r-1'));
    expect(deps.state.getTransfer('r-1')?.state).toBe('transferring');
  });
});
