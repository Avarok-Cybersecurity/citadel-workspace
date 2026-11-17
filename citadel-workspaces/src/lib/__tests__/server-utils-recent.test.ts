import { describe, it, expect, beforeEach } from 'vitest';
import { saveRecentServer, getRecentServers } from '../server-utils';
import type { StoredServer } from '@/lib/server-utils';

/**
 * The recent-server list is what the connect screen falls back to when the
 * service cannot be reached. It is written on every successful connect and, until
 * now, was never read — so none of this was exercised.
 *
 * localStorage only, which jsdom provides, so no mocking.
 */
beforeEach(() => localStorage.clear());

describe('recent servers', () => {
  it('returns nothing when none have been saved', () => {
    expect(getRecentServers()).toEqual([]);
  });

  it('remembers a server it was given', () => {
    saveRecentServer({ serverAddress: 'alpha.example:12349' });

    const [server] = getRecentServers();
    expect(server.serverAddress).toBe('alpha.example:12349');
    expect(server.lastConnected).toBeGreaterThan(0);
  });

  it('puts the most recent first', () => {
    saveRecentServer({ serverAddress: 'alpha.example' });
    saveRecentServer({ serverAddress: 'beta.example' });

    // Entries used to be appended in first-seen order, so the OLDEST sat at the
    // top of a list labelled "recent" and shown in order.
    expect(getRecentServers().map(s => s.serverAddress)).toEqual([
      'beta.example',
      'alpha.example',
    ]);
  });

  it('moves a server back to the top instead of duplicating it', () => {
    saveRecentServer({ serverAddress: 'alpha.example' });
    saveRecentServer({ serverAddress: 'beta.example' });
    saveRecentServer({ serverAddress: 'alpha.example' });

    expect(getRecentServers().map(s => s.serverAddress)).toEqual([
      'alpha.example',
      'beta.example',
    ]);
  });

  it('keeps the list bounded', () => {
    for (let i: number = 0; i < 15; i++) {
      saveRecentServer({ serverAddress: `server-${i}.example` });
    }

    const stored: StoredServer[] = getRecentServers();
    // It grew for the lifetime of the install before; nothing ever removed an
    // entry.
    expect(stored.length).toBeLessThanOrEqual(10);
    // And it drops the oldest, not the newest.
    expect(stored[0].serverAddress).toBe('server-14.example');
  });

  it('survives corrupt storage rather than throwing on load', () => {
    localStorage.setItem('citadel_recent_servers', 'not json at all');
    expect(getRecentServers()).toEqual([]);

    localStorage.setItem('citadel_recent_servers', '{"not":"an array"}');
    expect(getRecentServers()).toEqual([]);
  });
});
