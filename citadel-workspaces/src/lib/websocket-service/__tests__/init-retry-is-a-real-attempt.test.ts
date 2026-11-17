/**
 * `initService` caches its in-flight promise so concurrent callers share one
 * attempt. On failure the promise was left set, so the guard replayed the same
 * rejection for ever: the user starts the agent the error told them to start,
 * presses Retry, and gets the identical stale error instantly with nothing
 * re-attempting. Only a page reload recovered.
 *
 * Counting real attempts is the discriminating assertion. Asserting that the
 * second call rejects would pass on the broken version too — the broken version
 * rejects precisely because it never tried.
 */
import { describe, it, expect, vi, beforeEach  } from 'vitest';
import { initService } from '../initialization';
import { GLOBAL_INIT_KEY } from '../../websocket';
import type { WebSocketServiceCore } from '../core';

vi.mock('../../multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { isLeader: true }) };
});
vi.mock('../../wasm-debug-bridge', () => ({ setupWasmDebugBridge: (): void => {} }));

function coreWith(createWebSocketAsLeader: () => Promise<unknown>): WebSocketServiceCore {
  return {
    isInitialized: false,
    initializationPromise: null,
    client: null,
    initOps: {
      // Part of the contract since the demotion listener moved out of the
      // follower-only path; doInit calls it before the leader/follower branch.
      registerLeadershipListener: () => {},
      waitForLeaderElection: async () => {},
      initializeAsFollower: () => {},
      createWebSocketAsLeader,
    },
  } as unknown as WebSocketServiceCore;
}

describe('initService', () => {
  beforeEach(() => {
    // Test 1 leaves a successful init on the window global; without clearing it
    // the real GLOBAL_INIT_KEY short-circuit returns before initOps is reached
    // and the next test measures nothing.
    (window as unknown as Record<string, unknown>)[GLOBAL_INIT_KEY] = undefined;
  });

  it('re-attempts after a failure instead of replaying the stale rejection', async () => {
    const create: ReturnType<typeof vi.fn> = vi
      .fn()
      .mockRejectedValueOnce(new Error('internal service unreachable'))
      .mockResolvedValueOnce({ ok: true });
    const service: WebSocketServiceCore = coreWith(create);

    await expect(initService(service)).rejects.toThrow('internal service unreachable');
    expect(create).toHaveBeenCalledTimes(1);

    // The retry the user presses. It must actually try again.
    await initService(service);

    expect(create).toHaveBeenCalledTimes(2);
    expect(service.isInitialized).toBe(true);
  });

  it('still shares one in-flight attempt between concurrent callers', async () => {
    let release!: (v: unknown) => void;
    const pending: Promise<unknown> = new Promise((r): void => { release = r; });
    const create: ReturnType<typeof vi.fn> = vi.fn((): Promise<unknown> => pending);
    const service: WebSocketServiceCore = coreWith(create);

    const a: Promise<void> = initService(service);
    const b: Promise<void> = initService(service);
    await Promise.resolve();
    release({ ok: true });
    await Promise.all([a, b]);

    // Clearing the promise on failure must not break the dedup on success.
    expect(create).toHaveBeenCalledTimes(1);
  });
});
