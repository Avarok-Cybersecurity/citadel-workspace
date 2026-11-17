/**
 * A permissions answer that lands before the wait begins still counts.
 *
 * Measured live (instrumented bundle): the UserPermissions response arrived, the cache
 * was filled and 'permissions:updated' was emitted -- all before fetchPermissions reached
 * awaitPermissionsLoaded, which only ever looked at the cache when an event fired. It
 * waited out its timeout and rejected, the retries raced the same way, and a Member was
 * offered the hierarchy's "+" because "loading" and "gave up" both permit.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { awaitPermissionsLoaded } from '../await-permissions-loaded';
import type { DomainPermissions } from '../types';

const DOMAIN: string = 'workspace-root';
const entry = (lastUpdated: number): DomainPermissions =>
  ({ domainId: DOMAIN, role: 'Member', permissions: new Set(), lastUpdated } as unknown as DomainPermissions);

describe('waiting for a permissions load', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('resolves at once when the answer for this request is already cached', async () => {
    const asked: number = 1_000;
    const cached: DomainPermissions = entry(asked + 5);
    await expect(awaitPermissionsLoaded(DOMAIN, () => cached, asked)).resolves.toBe(cached);
  });

  it('does not take an entry from before the request for its answer', async () => {
    vi.useFakeTimers();
    const pending: Promise<DomainPermissions> = awaitPermissionsLoaded(DOMAIN, () => entry(999), 1_000);
    const outcome: Promise<string> = pending.then(() => 'resolved', () => 'rejected');
    await vi.runAllTimersAsync();
    expect(await outcome).toBe('rejected');
  });
});
