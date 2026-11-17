/**
 * A relay lookup that breaks is reported in production, not only in debug builds.
 *
 * Found live: every lookup timed out, each connection went ahead without a relay, and
 * nothing said so. A policy answer (the tenant has no relay for this session) stays quiet;
 * a broken lookup does not.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IceServersCache } from '../cache';

afterEach(() => { vi.restoreAllMocks(); });

describe('a relay lookup', () => {
  it('that times out is reported, with its reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache: IceServersCache = new IceServersCache({ request: async (): Promise<unknown> => { throw new Error('GetIceServers: no answer within 5000ms'); } }, () => 0);
    expect(await cache.get(7n)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(JSON.stringify(warn.mock.calls[0], (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)))).toContain('no answer within 5000ms');
  });

  it('that the tenant declines stays quiet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache: IceServersCache = new IceServersCache({ request: async (): Promise<unknown> => ({ IceServersUnavailable: { reason: 'free tier' } }) }, () => 0);
    expect(await cache.get(7n)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
