/**
 * Waiting for permissions must not depend on listener order.
 *
 * `awaitPermissionsLoaded` listened for `user:permissions:loaded` and read the
 * cache the instant it fired. The service fills that cache in the SAME event:
 * synchronously when the payload's user id matches the one it can read without
 * awaiting, and otherwise inside a `.then` — a path whose own comment says it
 * exists because "the synchronous accessor is null for a user who logged IN
 * rather than registering".
 *
 * So for a user who logged in, the cache is filled a tick after the event, and
 * the awaiter had already read it empty and rejected:
 *
 *   [PermissionsContext] Error fetching permissions:
 *   Error: Permissions not found in cache after load
 *
 * printed over and over in `test:prev-sessions`, which logs in rather than
 * registering. And even on the synchronous path it only worked because the
 * service's listener happened to be registered first.
 *
 * The trigger is now the event that means what the awaiter needs —
 * `permissions:updated`, "the cache now holds this domain" — which the service
 * emits on both paths.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { eventEmitter } from '@/lib/event-emitter';
import { awaitPermissionsLoaded } from '../await-permissions-loaded';
import type { DomainPermissions } from '../types';

const DOMAIN: string = 'office-1';
// After the fixtures' lastUpdated (0), so these entries are never taken as already-landed
// answers and each test exercises the wait itself.
const ASKED_AT: number = 1;

function permissions(): DomainPermissions {
  return {
    domainId: DOMAIN,
    role: 'Admin',
    permissions: new Set(),
    lastUpdated: 0,
  } as unknown as DomainPermissions;
}

afterEach((): void => { vi.useRealTimers(); });

describe('awaiting a permissions load', () => {
  it('resolves when the cache is filled a tick after the load', async (): Promise<void> => {
    // A holder rather than a reassigned `let`: the point is that the cache is
    // read LATER, by the awaiter, not captured now.
    const cache: { value?: DomainPermissions } = {};
    const pending: Promise<DomainPermissions> = awaitPermissionsLoaded(DOMAIN, () => cache.value, ASKED_AT);

    // Exactly the async path: the load lands, and the cache is filled later.
    eventEmitter.emit('user:permissions:loaded', { domainId: DOMAIN });
    await Promise.resolve();
    cache.value = permissions();
    eventEmitter.emit('permissions:updated', { domainId: DOMAIN });

    await expect(pending).resolves.toMatchObject({ domainId: DOMAIN });
  });

  it('ignores another domain finishing first', async (): Promise<void> => {
    // A holder rather than a reassigned `let`: the point is that the cache is
    // read LATER, by the awaiter, not captured now.
    const cache: { value?: DomainPermissions } = {};
    const pending: Promise<DomainPermissions> = awaitPermissionsLoaded(DOMAIN, () => cache.value, ASKED_AT);

    eventEmitter.emit('permissions:updated', { domainId: 'somewhere-else' });
    cache.value = permissions();
    eventEmitter.emit('permissions:updated', { domainId: DOMAIN });

    await expect(pending).resolves.toMatchObject({ domainId: DOMAIN });
  });

  it('registers a listener while waiting, so the count below means something', async (): Promise<void> => {
    // Without this, the timeout test compares 0 to 0 and passes for a function
    // that never listened at all.
    const before: number = eventEmitter.listenerCount('permissions:updated');
    const pending: Promise<DomainPermissions> = awaitPermissionsLoaded(DOMAIN, () => permissions(), ASKED_AT);
    expect(eventEmitter.listenerCount('permissions:updated')).toBe(before + 1);
    eventEmitter.emit('permissions:updated', { domainId: DOMAIN });
    await pending;
    expect(eventEmitter.listenerCount('permissions:updated')).toBe(before);
  });

  it('does not leave a listener behind when it times out', async (): Promise<void> => {
    vi.useFakeTimers();
    const before: number = eventEmitter.listenerCount('permissions:updated');
    const pending: Promise<DomainPermissions> = awaitPermissionsLoaded(DOMAIN, () => undefined, ASKED_AT);
    const settled: Promise<unknown> = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(60_000);
    const error: unknown = await settled;
    expect(String(error)).toContain('timeout');
    expect(
      eventEmitter.listenerCount('permissions:updated'),
      'a timed-out fetch used to leave its listener on the global emitter for ' +
        'the life of the tab, one per timeout',
    ).toBe(before);
  });
});
