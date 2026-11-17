/**
 * A transfer this side's agent refuses tells the peer, so the peer's offer ends too.
 *
 * A late refusal (a-late-send-refusal-fails-the-transfer.test.ts) reaches only the side whose
 * agent refused. The sender's bubble failed; the recipient's kept "Waiting…" for a transfer that
 * could no longer happen, because nothing crossed to them.
 *
 * Real: FileTransferIO, FileTransferState, the status handler and the cancel signal's encoding.
 * Mocked: the tab's selected session (IndexedDB) and the P2P socket send — the two edges this
 * process has no peer or storage for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deserializeP2PCommand } from '@/types/p2p-commands';
import type { FileTransfer } from '../types';

const wire: { from: bigint; to: bigint; bytes: Uint8Array }[] = [];
vi.mock('../../tab-context', () => ({ getSelectedUser: async (): Promise<{ selectedCid: bigint }> => ({ selectedCid: 7n }) }));
vi.mock('../../p2p/message-send-operations', () => ({
  sendAllowingForAConcurrentOpen: async (from: bigint, to: bigint, bytes: Uint8Array): Promise<void> => {
    wire.push({ from, to, bytes });
  },
}));

const { FileTransferIO } = await import('../io');
const { FileTransferState } = await import('../state');
const { handleProtocolStatus } = await import('../protocol-transfer-events');

function outgoing(state: FileTransfer['state']): FileTransfer {
  return {
    id: 'T1', fileName: 'a.bin', fileSize: 3, fileType: 'application/octet-stream', mode: 'p2p',
    state, progress: 0, senderCid: '7', recipientCid: '42', createdAt: 0, updatedAt: 0, isIncoming: false,
  } as FileTransfer;
}

async function refuse(transfer: FileTransfer): Promise<FileTransfer | undefined> {
  const state: InstanceType<typeof FileTransferState> = new FileTransferState();
  state.setTransfer(transfer);
  const io: InstanceType<typeof FileTransferIO> = new FileTransferIO();
  await handleProtocolStatus(
    { state, io, emitStateChange: () => undefined, saveTransfer: async () => undefined },
    { protocolId: '', transferId: 'T1', cid: 7n, success: false, accepted: false, message: 'not enabled' }
  );
  io.dispose();
  return state.getTransfer('T1');
}

describe('a refused transfer', () => {
  beforeEach(() => { wire.length = 0; });

  it('fails here and cancels the offer at the peer, without leaking the agent reason', async () => {
    const after: FileTransfer | undefined = await refuse(outgoing('pending'));

    expect(after?.state).toBe('error');
    expect(wire).toHaveLength(1);
    expect(wire[0]).toMatchObject({ from: 7n, to: 42n });
    const sent: unknown = deserializeP2PCommand(wire[0].bytes);
    expect(JSON.stringify(sent, (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)))
      .not.toContain('not enabled');
    expect(sent).toMatchObject({
      payload: { layer: { type: 'FileTransferCancel', transfer_id: 'T1' } },
    });
  });

  it('says nothing to the peer about a transfer that had already ended', async () => {
    const after: FileTransfer | undefined = await refuse(outgoing('complete'));

    expect(after?.state).toBe('complete');
    expect(wire).toHaveLength(0);
  });
});
