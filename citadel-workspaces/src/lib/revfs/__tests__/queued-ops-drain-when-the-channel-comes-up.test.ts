/**
 * Queued operations drain when the channel comes up — not only on manual Sync.
 *
 * `retryPendingOps` was documented "call when a channel becomes usable", but
 * its only production caller was the file manager's Sync button. Operations
 * queued while a peer was unreachable — including deletions whose bytes were
 * already destroyed — sat indefinitely unless the user happened to press it.
 * The real signal existed all along: `p2p:channel-ready { peerCid }` from the
 * auto-connect service. This pins both the wiring module and the fact that
 * RevfsService actually installs it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wireDrainOnChannelReady, type DrainDeps } from '../drain-on-channel-ready';
import { eventEmitter } from '@/lib/event-emitter';
import { peerTreeKey } from '../tree-queries';
import { forgetSeenOperations } from '../seen-operations';
import {
  createTestService,
  defaultIntentHandler,
  getExecuteCalls,
  getState,
  ALICE,
  BOB,
} from './revfs-service-test-helpers';
import { RevfsOpType } from '@/types/revfs-types';
import type { RevfsOperation, TreeKey } from '@/types/revfs-types';
import type { RevfsIntent } from '@/types/revfs-intents';
import type { RevfsService } from '../revfs-service';
import type { RevfsState } from '../revfs-state';

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('wireDrainOnChannelReady', () => {
  it('drains the queue for the peer whose channel came up', async () => {
    const calls: Array<[TreeKey, bigint]> = [];
    const deps: DrainDeps = {
      getCurrentCid: async (): Promise<bigint> => ALICE,
      retryPendingOps: async (key: TreeKey, peerCid: bigint) => {
        calls.push([key, peerCid]);
        return { stillPending: 0, discarded: 0 };
      },
    };
    const unwire: () => void = wireDrainOnChannelReady(deps);

    eventEmitter.emit('p2p:channel-ready', { peerCid: BOB });
    await flush();

    expect(calls).toEqual([[peerTreeKey(ALICE, BOB), BOB]]);
    unwire();
  });

  it('stops draining once unwired', async () => {
    const calls: bigint[] = [];
    const unwire: () => void = wireDrainOnChannelReady({
      getCurrentCid: async (): Promise<bigint> => ALICE,
      retryPendingOps: async (_key: TreeKey, peerCid: bigint) => {
        calls.push(peerCid);
        return { stillPending: 0, discarded: 0 };
      },
    });
    unwire();

    eventEmitter.emit('p2p:channel-ready', { peerCid: BOB });
    await flush();

    expect(calls).toEqual([]);
  });

  it('does nothing without a current CID, and does not throw', async () => {
    const calls: bigint[] = [];
    const unwire: () => void = wireDrainOnChannelReady({
      getCurrentCid: async (): Promise<bigint | null> => null,
      retryPendingOps: async (_key: TreeKey, peerCid: bigint) => {
        calls.push(peerCid);
        return { stillPending: 0, discarded: 0 };
      },
    });

    eventEmitter.emit('p2p:channel-ready', { peerCid: BOB });
    await flush();

    expect(calls).toEqual([]);
    unwire();
  });
});

describe('RevfsService', () => {
  beforeEach((): void => {
    forgetSeenOperations();
  });

  it('installs the drain, so channel-ready re-sends what was queued', async () => {
    const service: RevfsService = createTestService(defaultIntentHandler());
    const state: RevfsState = getState(service);
    const key: TreeKey = peerTreeKey(ALICE, BOB);

    const queued: RevfsOperation = { op_id: 'queued-1', op_type: RevfsOpType.Mkdir, path: '/late', timestamp: 0 };
    state.addPendingOp(key, { operation: queued, retryCount: 0, createdAt: 0 });

    eventEmitter.emit('p2p:channel-ready', { peerCid: BOB });

    await vi.waitFor((): void => {
      const sent: RevfsIntent[] = getExecuteCalls(service).filter(
        (i: RevfsIntent) => i.type === 'send-revfs-op' && i.operation.op_id === 'queued-1',
      );
      expect(sent, 'nothing drained the queue when the channel came up').toHaveLength(1);
    });
  });
});
