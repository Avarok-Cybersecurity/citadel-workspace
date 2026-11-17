/**
 * Two handlers hand-rolled the terminal-state set and both omitted 'expired'.
 *
 * `transfer-outcome.ts` exports `isTerminalTransferState`, whose set names
 * 'expired' explicitly — its own comment argues an expired offer must not be
 * resurrectable. Yet `handleTransferResponse` (async-transfers) and
 * `handleTransferCancel` (p2p-transfers) each guarded with a local
 * complete/error/cancelled/declined list. So:
 *
 *   - a peer's accept arriving after the offer's 7-day TTL flipped the
 *     sender's 'expired' record to 'transferring' — a busy progress bar for a
 *     transfer whose bytes nobody will ever send;
 *   - a late cancel rewrote 'expired' to 'cancelled', changing the recorded
 *     history of a transfer both sides had already agreed was over.
 *
 * (A third copy sits in transfer-lifecycle.ts's cancelTransfer, which even
 * omits 'error' and 'declined'; that file is owned by another change in
 * flight and is not covered here.)
 */
import { describe, it, expect, vi } from 'vitest';
import { handleTransferResponse, type AsyncTransferDeps } from '../async-transfers';
import { handleTransferCancel, type P2PTransferDeps } from '../p2p-transfers';
import { MessagingLayerType, type FileTransferState as LifecycleState } from '@/types/messaging-layer';
import type { FileTransfer } from '../types';

function transfer(state: LifecycleState, isIncoming: boolean): FileTransfer {
  return {
    id: 'transfer-1', fileName: 'notes.md', fileSize: 1024, fileType: 'text/markdown',
    state, progress: 0,
    senderCid: '7', recipientCid: '42',
    createdAt: 0, updatedAt: 0, expiresAt: 1_000, isIncoming,
  };
}

interface Harness {
  deps: AsyncTransferDeps & P2PTransferDeps;
  saved: FileTransfer[];
  emitted: FileTransfer[];
}

function harness(t: FileTransfer): Harness {
  const saved: FileTransfer[] = [];
  const emitted: FileTransfer[] = [];
  const deps: AsyncTransferDeps & P2PTransferDeps = {
    state: { getTransfer: (): FileTransfer => t },
    io: {},
    saveTransfer: async (x: FileTransfer): Promise<void> => { saved.push(x); },
    emitStateChange: (x: FileTransfer): void => { emitted.push(x); },
  } as unknown as AsyncTransferDeps & P2PTransferDeps;
  return { deps, saved, emitted };
}

function response(accepted: boolean): Parameters<typeof handleTransferResponse>[1] {
  return {
    type: MessagingLayerType.FileTransferResponse,
    transfer_id: 'transfer-1',
    accepted,
    timestamp: 0,
  };
}

function cancel(): Parameters<typeof handleTransferCancel>[1] {
  return {
    type: MessagingLayerType.FileTransferCancel,
    transfer_id: 'transfer-1',
    reason: 'changed my mind',
    timestamp: 0,
  };
}

describe('an expired offer', () => {
  it('is not resurrected to transferring by a late accept', async () => {
    const t: FileTransfer = transfer('expired', false);
    const { deps, saved } = harness(t);

    await handleTransferResponse(deps, response(true), '42');

    expect(t.state, 'a 7-day-late accept revived an expired offer').toBe('expired');
    expect(saved).toEqual([]);
  });

  it('is not rewritten to cancelled by a late cancel', async () => {
    const t: FileTransfer = transfer('expired', true);
    const { deps, saved } = harness(t);

    await handleTransferCancel(deps, cancel(), '7');

    expect(t.state, 'a late cancel rewrote an expired offer\'s history').toBe('expired');
    expect(saved).toEqual([]);
  });
});

describe('a live transfer', () => {
  // The opposite over-correction: a guard that ignores every signal would
  // pass both tests above. The signals must still move non-terminal states.
  it('still moves to transferring on an accept', async () => {
    const t: FileTransfer = transfer('pending', false);
    const { deps, saved, emitted } = harness(t);

    await handleTransferResponse(deps, response(true), '42');

    expect(t.state).toBe('transferring');
    expect(saved).toHaveLength(1);
    expect(emitted).toHaveLength(1);
  });

  it('still moves to declined on a decline', async () => {
    const t: FileTransfer = transfer('pending', false);
    const { deps } = harness(t);

    await handleTransferResponse(deps, response(false), '42');

    expect(t.state).toBe('declined');
  });

  it('is still cancellable mid-transfer', async () => {
    const t: FileTransfer = transfer('transferring', true);
    const { deps, saved } = harness(t);

    await handleTransferCancel(deps, cancel(), '7');

    expect(t.state).toBe('cancelled');
    expect(t.errorMessage).toBe('changed my mind');
    expect(saved).toHaveLength(1);
  });
});

void vi;
