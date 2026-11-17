/**
 * The agent's tick counts are u64. serde-wasm-bindgen hands any u64 to the page as a BigInt,
 * whatever the TypeScript binding declares, and `group / total` on BigInts mixed with numbers
 * threw "Cannot mix BigInt and other types" inside the websocket handler: a channel file's
 * progress never reached its bubble (CI, a-channel-file-reaches-members-only).
 */
import { describe, it, expect } from 'vitest';
import { parseTickNotification, type TickCorrelation } from '../tick-events';
import type { FileTransferTickNotification } from '../protocol-types';

const correlation = (): TickCorrelation => ({
  objectIdToTransferId: new Map<string, string>(),
  requestIdToTransferId: new Map<string, string>([['send-1', 'transfer-1']]),
  requestIdToDownloadPath: new Map<string, string>(),
  foreignRequestIds: new Set<string>(),
});

const tick = (status: unknown): FileTransferTickNotification =>
  ({ cid: 7n, peer_cid: 42n, status, request_id: 'send-1' }) as FileTransferTickNotification;

describe('a tick whose counts arrive as BigInt', () => {
  it.each(['TransferTick', 'ReceptionTick'])('%s gives progress in numbers', (variant: string) => {
    expect(parseTickNotification(tick({ [variant]: [250n, 1000n, 9n] }), correlation())).toMatchObject({
      kind: 'progress', transferId: 'transfer-1', bytesTransferred: 250, totalBytes: 1000, percentage: 25,
    });
  });

  it('a tick counted in numbers is unchanged', () => {
    expect(parseTickNotification(tick({ TransferTick: [1, 2, 9] }), correlation())).toMatchObject({
      bytesTransferred: 1, totalBytes: 2, percentage: 50,
    });
  });
});
