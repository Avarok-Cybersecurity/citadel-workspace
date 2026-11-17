/**
 * Subscriptions whose unsubscribe was discarded.
 *
 * `react-hooks/exhaustive-deps` is set to "error" in this repo, so stale-closure
 * bugs are largely linted away. The class that survives is the one the lint rule
 * cannot see: an effect that registers a listener and returns nothing. Nothing
 * breaks visibly — setState on an unmounted component is a no-op — so these
 * accumulate silently, one per remount, for the life of the session.
 *
 * Both facades below already had a correct counterpart in-tree
 * (`P2PMessengerManager.onConnectionChange`, `use-domain-call-members`) whose
 * fix was never carried across.
 */
import { describe, it, expect, vi, beforeEach  } from 'vitest';
import { renderHook , type RenderHookResult } from '@testing-library/react';
import { ConnectionService } from '@/lib/connection-service/service';
import { workspaceEvents } from '@/lib/workspace-events';
import { useDomainMembers , type DomainMembers } from '@/hooks/use-domain-members';

describe('ConnectionService.onConnectionChange', () => {
  beforeEach(() => {
    ConnectionService.getInstance().cleanup();
  });

  it('returns an unsubscribe that actually stops the handler', () => {
    const service: ConnectionService = ConnectionService.getInstance();
    const handler: ReturnType<typeof vi.fn> = vi.fn();

    const unsubscribe: () => void = service.onConnectionChange(handler);
    // A void return is the defect: callers have nothing to return from their
    // effect, so every remount leaves another live handler behind.
    expect(typeof unsubscribe).toBe('function');

    service.updateConnectionStatus({ cid: 1n, isConnected: true } as never);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    service.updateConnectionStatus({ cid: 1n, isConnected: false } as never);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not accumulate handlers when the same effect re-subscribes', () => {
    const service: ConnectionService = ConnectionService.getInstance();
    const calls: number[] = [];

    // Simulate an effect that re-runs: subscribe, clean up, subscribe again.
    for (let run: number = 0; run < 5; run++) {
      const unsubscribe: () => void = service.onConnectionChange((): number => calls.push(run));
      unsubscribe();
    }
    const live: () => void = service.onConnectionChange((): number => calls.push(99));

    // `onConnectionChange` replays the current connection to a new subscriber
    // immediately, so everything recorded so far is that replay, not a dispatch.
    // Only what arrives after this line tells us who is still registered.
    calls.length = 0;

    service.updateConnectionStatus({ cid: 1n, isConnected: true } as never);
    live();

    expect(calls).toEqual([99]);
  });
});

describe('useDomainMembers', () => {
  it('releases its members:loaded listener on unmount', () => {
    const before: number = workspaceEvents.listenerCount('members:loaded');

    const first: RenderHookResult<DomainMembers, unknown> = renderHook((): DomainMembers => useDomainMembers('domain-1'));
    expect(workspaceEvents.listenerCount('members:loaded')).toBe(before + 1);
    first.unmount();

    const second: RenderHookResult<DomainMembers, unknown> = renderHook((): DomainMembers => useDomainMembers('domain-1'));
    second.unmount();

    // Growing by one per mount is the leak: MembersSection lives in AppLayout,
    // which remounts on every route change.
    expect(workspaceEvents.listenerCount('members:loaded')).toBe(before);
  });
});
