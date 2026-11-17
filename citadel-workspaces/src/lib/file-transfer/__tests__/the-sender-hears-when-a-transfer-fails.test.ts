/**
 * When a transfer fails on the recipient, the sender is told it failed.
 *
 * Live: the Mac's "Transfer failed: IO error ..." never crossed to the Windows
 * sender, whose bubble stayed "File ready, waiting for acceptance" or read
 * "cancelled". The recipient's failures were local: a Fail tick on its stream
 * errored its own bubble and said nothing, and the one failure that did cross
 * (its agent refusing the accept) arrived as a plain cancel, which the sender
 * shows as if someone had chosen to stop.
 *
 * Real: FileTransferIO, FileTransferState, the protocol handlers, the cancel
 * signal's encoding and the peer's handling of it. Mocked: the tab's selected
 * session (IndexedDB) and the P2P socket send -- the edges with no peer here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deserializeP2PCommand } from '@/types/p2p-commands';
import { MessagingLayerType, type FileTransferCancelData } from '@/types/messaging-layer';
import type { FileTransfer } from '../types';

const wire: { from: bigint; to: bigint; bytes: Uint8Array }[] = [];
vi.mock('../../tab-context', () => ({ getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 42n }) }));
vi.mock('../../p2p/message-send-operations', () => ({
  sendAllowingForAConcurrentOpen: async (from: bigint, to: bigint, bytes: Uint8Array): Promise<void> => {
    wire.push({ from, to, bytes });
  },
}));

const { FileTransferIO } = await import('../io');
const { FileTransferState } = await import('../state');
const { handleProtocolComplete, handleProtocolStatus } = await import('../protocol-transfer-events');
const { handleTransferCancel } = await import('../p2p-transfers');

type Deps = Parameters<typeof handleProtocolComplete>[0];

function transfer(isIncoming: boolean, state: FileTransfer['state']): FileTransfer {
  return {
    id: 'T1', fileName: 'shot.png', fileSize: 3, fileType: 'image/png', mode: 'async',
    state, progress: 0, senderCid: '7', recipientCid: '42', createdAt: 0, updatedAt: 0, isIncoming,
  } as FileTransfer;
}

function world(t: FileTransfer): { deps: Deps; state: InstanceType<typeof FileTransferState>; io: InstanceType<typeof FileTransferIO> } {
  const state: InstanceType<typeof FileTransferState> = new FileTransferState();
  state.setTransfer(t);
  const io: InstanceType<typeof FileTransferIO> = new FileTransferIO();
  return { deps: { state, io, emitStateChange: () => undefined, saveTransfer: async () => undefined }, state, io };
}

function sentCancel(): FileTransferCancelData & { type: MessagingLayerType.FileTransferCancel } {
  expect(wire).toHaveLength(1);
  expect(wire[0]).toMatchObject({ from: 42n, to: 7n });
  const command: { payload: { layer: FileTransferCancelData & { type: MessagingLayerType.FileTransferCancel } } } =
    deserializeP2PCommand(wire[0].bytes) as unknown as { payload: { layer: FileTransferCancelData & { type: MessagingLayerType.FileTransferCancel } } };
  return command.payload.layer;
}

describe('a transfer that fails on the recipient', () => {
  beforeEach(() => { wire.length = 0; });

  it('tells the sender it FAILED when the reception stream fails', async () => {
    const { deps, io } = world(transfer(true, 'transferring'));
    await handleProtocolComplete(deps, { cid: 42n, peerCid: 7n, direction: 'incoming', transferId: 'T1', success: false, errorMessage: 'IO error' });
    io.dispose();
    expect(sentCancel()).toMatchObject({ type: 'FileTransferCancel', transfer_id: 'T1', failed: true });
  });

  it('tells the sender it FAILED when its own agent refuses the accept', async () => {
    const { deps, io } = world(transfer(true, 'pending'));
    await handleProtocolStatus(deps, { protocolId: '', transferId: 'T1', cid: 42n, success: false, accepted: false, message: 'File transfer not found' });
    io.dispose();
    expect(sentCancel()).toMatchObject({ transfer_id: 'T1', failed: true });
  });

  it('says nothing when the failure report is a duplicate of one already recorded', async () => {
    const { deps, io } = world(transfer(true, 'error'));
    await handleProtocolComplete(deps, { cid: 42n, peerCid: 7n, direction: 'incoming', transferId: 'T1', success: false });
    io.dispose();
    expect(wire).toHaveLength(0);
  });
});

describe('the sender, told the transfer failed', () => {
  it('shows it failed, with the reason, rather than cancelled', async () => {
    const { deps, state, io } = world(transfer(false, 'transferring'));
    await handleTransferCancel(deps, {
      type: MessagingLayerType.FileTransferCancel, transfer_id: 'T1',
      reason: 'The transfer failed on the other device.', failed: true, timestamp: 1,
    }, '42');
    io.dispose();
    expect(state.getTransfer('T1')).toMatchObject({ state: 'error', errorMessage: 'The transfer failed on the other device.' });
  });

  it('still shows a plain cancel as cancelled', async () => {
    const { deps, state, io } = world(transfer(false, 'transferring'));
    await handleTransferCancel(deps, { type: MessagingLayerType.FileTransferCancel, transfer_id: 'T1', reason: 'Sender cancelled transfer', timestamp: 1 }, '42');
    io.dispose();
    expect(state.getTransfer('T1')?.state).toBe('cancelled');
  });
});
