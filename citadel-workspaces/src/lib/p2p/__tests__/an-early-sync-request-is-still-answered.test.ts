/**
 * A RE-VFS operation that arrives before the engine has started is handed to
 * it once it starts, not dropped.
 *
 * The router dropped it "to be retried". Only mutations are retried; a
 * SyncRequest dropped here was never answered, and the asker was told the peer
 * did not answer.
 *
 * The real router and loader; the engine's handler is spied, not replaced, so
 * what is observed is whether the router reached it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { routeRevfsOperation } from '../revfs-layer-routing';
import { startRevfs, forgetRevfsLoad } from '@/lib/revfs/revfs-loader';
import { revfsService } from '@/lib/revfs';
import type { RevfsIODeps } from '@/lib/revfs/revfs-io';
import { RevfsOpType, type RevfsOperation } from '@/types/revfs-types';

const REQUEST: RevfsOperation = { op_id: 'sync-1', op_type: RevfsOpType.SyncRequest, path: '/', timestamp: 0 };

function deps(): RevfsIODeps {
  return {
    sendP2PMessageReliable: vi.fn(async (): Promise<void> => {}),
    getCurrentCid: vi.fn(async (): Promise<bigint> => 2n),
    sendInternalServiceRequest: vi.fn(async (): Promise<void> => {}),
    // The channel is up: these tests are about what travels over it.
    openPeerChannel: async (): Promise<boolean> => true,
  };
}

describe('a RE-VFS operation that beats the engine', () => {
  beforeEach((): void => { forgetRevfsLoad(); vi.restoreAllMocks(); });

  it('is handled once the engine starts', async () => {
    const handled = vi.spyOn(revfsService, 'handleRevfsOperation').mockResolvedValue(undefined);
    await routeRevfsOperation(1n, 2n, REQUEST);
    expect(handled).not.toHaveBeenCalled();

    await startRevfs(deps());
    await vi.waitFor(() => expect(handled).toHaveBeenCalledWith(1n, 2n, REQUEST));
  });
});
