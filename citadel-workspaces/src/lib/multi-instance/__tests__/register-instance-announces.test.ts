/**
 * Registering an instance must announce it.
 *
 * The self-heal suite mocks `instanceManager`, so it fires
 * `instance:registered` by hand to drive the drain. That covers the router's
 * half and nothing of the producer's: delete the emit from `registerInstance`
 * and the buffer is never drained, orphaned CID-routed messages — call media
 * among them — land on the leader tab, and that suite stays green.
 *
 * This is the other half, on the real object.
 */

import { describe, it, expect, vi, beforeEach, afterEach  } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { instanceManager } from '../instance-manager';

describe('registerInstance', () => {
  const heard: ReturnType<typeof vi.fn> = vi.fn();

  beforeEach(() => {
    heard.mockReset();
    eventEmitter.on('instance:registered', heard);
  });

  afterEach(() => {
    eventEmitter.off('instance:registered', heard);
  });

  it('announces the instance and its cid', () => {
    instanceManager.registerInstance('tab-a', 4242n);

    expect(heard).toHaveBeenCalledWith({ instanceId: 'tab-a', cid: 4242n });
  });

  it('announces a registration that has no cid yet', () => {
    // The documented contract: null fires on the initial registry seed, before
    // ConnectSuccess. Subscribers guard for it; the emit must still happen or
    // the later cid-report has nothing to correct.
    instanceManager.registerInstance('tab-b', null);

    expect(heard).toHaveBeenCalledWith({ instanceId: 'tab-b', cid: null });
  });

  it('does not announce an unregistration under the same name', () => {
    // Also documented, and load-bearing: the drain treats every event as "this
    // instance now owns this cid". An unregister announced here would make the
    // router forward to a tab that has gone.
    instanceManager.registerInstance('tab-c', 7n);
    heard.mockReset();

    instanceManager.unregisterInstance('tab-c');

    expect(heard).not.toHaveBeenCalled();
  });
});
