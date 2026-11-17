/**
 * The protocol plane's tick stream must parse the CANONICAL wire shapes and
 * drive a transfer to a terminal state.
 *
 * History, kept because it explains the test vectors: protocol-types.ts used
 * to hand-write `ObjectTransferStatus` with an `object_id` on every variant
 * and object-shaped completes. The real enum (generated from Rust in
 * @avarok/citadel-protocol-types) is
 *
 *   TransferTick / ReceptionTick: [group, total_groups, Mb/s]
 *   TransferComplete / ReceptionComplete: bare strings
 *   Fail: { Fail: "message" }
 *   ReceptionBeginning: [download_path, VirtualObjectMetadata]
 *
 * so the old parser could never match a single real notification — which is
 * why the progress/complete path was dead. These tests feed the parser
 * exactly what the internal service sends.
 */
import { describe, it, expect, vi  } from 'vitest';
import { parseTickNotification, type TickCorrelation } from '../tick-events';
import { applyTransferOutcome } from '../transfer-outcome';
import type { FileTransferTickNotification, VirtualObjectMetadata } from '../protocol-types';
import type { FileTransfer } from '../types';
import type { P2PTransferDeps } from '../p2p-transfers';
import type { ParsedTick } from '@/lib/file-transfer/tick-events';

function correlation(): TickCorrelation {
  return {
    objectIdToTransferId: new Map(),
    requestIdToTransferId: new Map(),
    requestIdToDownloadPath: new Map(),
    foreignRequestIds: new Set(),
  };
}

function tick(
  status: FileTransferTickNotification['status'],
  over: Partial<FileTransferTickNotification> = {}
): FileTransferTickNotification {
  return { cid: 7n, peer_cid: 42n, status, request_id: 'req-1', ...over };
}

const metadata = (over: Partial<VirtualObjectMetadata> = {}): VirtualObjectMetadata =>
  ({
    name: 'report.pdf',
    date_created: '',
    author: 'alice',
    plaintext_length: 2048,
    group_count: 2,
    object_id: 90210n,
    cid: 42n,
    transfer_type: 'FileTransfer',
    ...over,
  }) as VirtualObjectMetadata;

describe('parseTickNotification against the canonical wire shapes', () => {
  it('parses a canonical ReceptionTick tuple into a percentage', () => {
    const parsed: ParsedTick = parseTickNotification(tick({ ReceptionTick: [1, 2, 50] }), correlation());
    expect(parsed).toMatchObject({ kind: 'progress', direction: 'incoming', percentage: 50 });
  });

  it('recognises a canonical bare-string ReceptionComplete', () => {
    const parsed: ParsedTick = parseTickNotification(tick('ReceptionComplete'), correlation());
    expect(parsed).toMatchObject({ kind: 'complete', direction: 'incoming', success: true });
  });

  it('recognises a canonical bare-string TransferComplete', () => {
    const parsed: ParsedTick = parseTickNotification(tick('TransferComplete'), correlation());
    expect(parsed).toMatchObject({ kind: 'complete', direction: 'outgoing', success: true });
  });

  it('turns Fail("msg") into an unsuccessful completion carrying the message', () => {
    const parsed: ParsedTick = parseTickNotification(tick({ Fail: 'disk full' }), correlation());
    expect(parsed).toMatchObject({ kind: 'complete', success: false, errorMessage: 'disk full' });
  });

  it('joins ReceptionBeginning to the transfer via object_id, then resolves the id-less stream by request_id', () => {
    const ctx: TickCorrelation = correlation();
    ctx.objectIdToTransferId.set('90210', 'uuid-1');

    const begin: ParsedTick = parseTickNotification(
      tick({ ReceptionBeginning: ['/downloads/report.pdf', metadata()] }),
      ctx
    );
    expect(begin).toMatchObject({ kind: 'progress', transferId: 'uuid-1', totalBytes: 2048 });

    // The ticks and the complete carry NO id of any kind — only the
    // request_id join made above lets them name the transfer.
    const mid: ParsedTick = parseTickNotification(tick({ ReceptionTick: [1, 2, 50] }), ctx);
    expect(mid).toMatchObject({ transferId: 'uuid-1', percentage: 50 });

    const done: ParsedTick = parseTickNotification(tick('ReceptionComplete'), ctx);
    expect(done).toMatchObject({
      kind: 'complete',
      transferId: 'uuid-1',
      downloadPath: '/downloads/report.pdf',
    });
  });

  it('marks a revfs stream foreign at ReceptionBeginning and drops its later events', () => {
    const ctx: TickCorrelation = correlation();
    const begin: ParsedTick = parseTickNotification(
      tick({
        ReceptionBeginning: [
          '/tmp/x',
          metadata({
            transfer_type: {
              RemoteEncryptedVirtualFilesystem: { virtual_path: '/v', security_level: 'Standard' },
            } as VirtualObjectMetadata['transfer_type'],
          }),
        ],
      }),
      ctx
    );
    expect(begin).toBeNull();
    // Same request_id: this ReceptionComplete belongs to the revfs pull, and
    // matching it against a chat transfer would falsely complete the chat.
    expect(parseTickNotification(tick('ReceptionComplete'), ctx)).toBeNull();
  });

  it('ignores peerless (C2S) streams', () => {
    expect(
      parseTickNotification(tick('ReceptionComplete', { peer_cid: null }), correlation())
    ).toBeNull();
  });
});

const transfer = (over: Partial<FileTransfer> = {}): FileTransfer =>
  ({ id: 't1', state: 'transferring', progress: 0, updatedAt: 0, ...over }) as FileTransfer;

function depsFor(t: FileTransfer): { deps: P2PTransferDeps; saveTransfer: ReturnType<typeof vi.fn>; emitStateChange: ReturnType<typeof vi.fn>; } {
  const saveTransfer: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => {});
  const emitStateChange: ReturnType<typeof vi.fn> = vi.fn();
  return {
    deps: {
      state: { getTransfer: (id: string) => (id === t.id ? t : undefined) },
      saveTransfer,
      emitStateChange,
    } as unknown as P2PTransferDeps,
    saveTransfer,
    emitStateChange,
  };
}

describe('applyTransferOutcome', () => {
  it('moves a transferring file to complete and persists it', async () => {
    const t: FileTransfer = transfer();
    const { deps, saveTransfer, emitStateChange } = depsFor(t);

    await applyTransferOutcome(deps, 't1', { success: true, downloadPath: '/dl/a.pdf' });

    expect(t.state).toBe('complete');
    expect(t.progress).toBe(100);
    expect(saveTransfer).toHaveBeenCalledOnce();
    expect(emitStateChange).toHaveBeenCalledOnce();
  });

  it('is a no-op once terminal, so two planes cannot double-report one transfer', async () => {
    const t: FileTransfer = transfer({ state: 'complete', downloadPath: '/dl/a.pdf' });
    const { deps, saveTransfer, emitStateChange } = depsFor(t);

    await applyTransferOutcome(deps, 't1', { success: false, errorMessage: 'late failure' });

    expect(t.state).toBe('complete');
    expect(t.downloadPath).toBe('/dl/a.pdf');
    expect(saveTransfer).not.toHaveBeenCalled();
    expect(emitStateChange).not.toHaveBeenCalled();
  });

  it('treats declined as terminal — a stray success tick must not resurrect a declined offer', async () => {
    const t: FileTransfer = transfer({ state: 'declined' });
    const { deps, saveTransfer } = depsFor(t);

    await applyTransferOutcome(deps, 't1', { success: true });

    expect(t.state).toBe('declined');
    expect(saveTransfer).not.toHaveBeenCalled();
  });
});
