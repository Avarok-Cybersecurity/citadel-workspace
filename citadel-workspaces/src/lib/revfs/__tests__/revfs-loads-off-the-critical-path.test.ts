/**
 * The engine loads on demand, and never reaches an operation uninitialized.
 *
 * A static import of `@/lib/revfs` from either `lib/p2p/message-handler-routing`
 * or `useConnectionHandler` puts the whole sync engine on the landing page's
 * critical path -- 8.6 KB before first paint. Deferring one of the two achieved
 * nothing: Rollup moved the engine from `app-services` into the entry chunk,
 * which is just as eager. Both now go through `revfs-loader`.
 *
 * The size win is guarded by `check:bundle` in CI. What THIS file guards is the
 * correctness cost of the change: two dynamic imports could each get the engine,
 * but only one of them configures it, so the router must not be able to hand an
 * operation to a service whose `initialize` has not run.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startRevfs, revfsWhenReady, forgetRevfsLoad } from '../revfs-loader';
import type { RevfsIODeps } from '../revfs-io';
// The engine the loader fetches on demand, transformed now, at collection, which
// no test timeout measures. Cold, that transform was the 1.1 s of "reports the
// engine once started", and a loaded runner took it past 5 s. The loader's own
// import() still runs; it resolves from the module cache.
import '../index';

function deps(): RevfsIODeps {
  return {
    sendP2PMessageReliable: vi.fn(async () => true),
    getCurrentCid: vi.fn(async () => 1n),
    sendInternalServiceRequest: vi.fn(async () => undefined),
    // The channel is up: these tests are about what travels over it.
    openPeerChannel: async (): Promise<boolean> => true,
  } as unknown as RevfsIODeps;
}

describe('loading REVFS on demand', () => {
  beforeEach((): void => { forgetRevfsLoad(); });

  it('reports no engine before anything has started one', (): void => {
    expect(
      revfsWhenReady(),
      'returning a promise here would hand the router an unconfigured service \
whose every operation throws, instead of letting it leave the op unacked',
    ).toBeNull();
  });

  it('reports the engine once started', async (): Promise<void> => {
    const started: ReturnType<typeof startRevfs> = startRevfs(deps());
    const pending: ReturnType<typeof revfsWhenReady> = revfsWhenReady();

    expect(pending, 'the router saw no engine after one was started').not.toBeNull();
    await expect(pending).resolves.toBe(await started);
  });

  it('initializes the service exactly once across repeated starts', async (): Promise<void> => {
    const first: Awaited<ReturnType<typeof startRevfs>> = await startRevfs(deps());
    const spy: ReturnType<typeof vi.spyOn> = vi.spyOn(first.revfsService, 'initialize');

    await startRevfs(deps());
    await startRevfs(deps());

    expect(
      spy,
      'a remount reinitialized a service that was already handling operations',
    ).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('resolves to a service that is past its own initialization guard', async (): Promise<void> => {
    const module: Awaited<ReturnType<typeof startRevfs>> = await startRevfs(deps());

    // The service guards every operation with
    //   if (!this.io) throw new Error('RevfsService not initialized ...')
    // so reaching ANY other outcome proves `initialize` ran. The stub deps here
    // are deliberately partial, so this call still fails -- the assertion is
    // about WHICH failure, not about success.
    const outcome: unknown = await module.revfsService
      .getTree(1n, 2n)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(
      String(outcome),
      'the engine resolved before initialize() had run',
    ).not.toContain('not initialized');
  });
});
