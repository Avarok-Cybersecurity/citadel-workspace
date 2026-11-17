/**
 * The switcher takes the CID the agent holds for an account.
 *
 * The stored copy can be empty (older builds erased it at every boot), so the live list is
 * the authority; an address the agent reports differently from the stored one must not
 * make a held account unreachable.
 */
import { describe, it, expect } from 'vitest';
import { liveSessionCid } from '../live-session-cid';
import type { ActiveSession } from '@/types/session-types';

function session(username: string, cid: bigint, server_address: string, server_host: string | null): ActiveSession {
  return { cid, username, server_address, server_host, peer_connections: {} } as unknown as ActiveSession;
}

describe('liveSessionCid', () => {
  it('finds a hosted session reported only by its dialled URL', () => {
    const live: ActiveSession[] = [session('bob0924', 7n, 'wss://bench.work.avarok.net/', null)];
    expect(liveSessionCid(live, { username: 'bob0924', serverAddress: 'bench.work.avarok.net' })).toBe(7n);
  });

  it('picks the session on the stored server when the username is on two servers', () => {
    const live: ActiveSession[] = [
      session('sam', 1n, 'wss://acme.work.avarok.net/', 'acme.work.avarok.net'),
      session('sam', 2n, 'wss://bench.work.avarok.net/', 'bench.work.avarok.net'),
    ];
    expect(liveSessionCid(live, { username: 'sam', serverAddress: 'bench.work.avarok.net' })).toBe(2n);
  });

  it('does not take another server’s session for a same-named account', () => {
    const live: ActiveSession[] = [session('sam', 1n, 'wss://acme.work.avarok.net/', 'acme.work.avarok.net')];
    expect(liveSessionCid(live, { username: 'sam', serverAddress: 'bench.work.avarok.net' })).toBeUndefined();
  });

  it('takes the only live session with the username when the agent reports an address the UI cannot read', () => {
    // Measured live: the switcher could not find a held account the landing page resumed by CID.
    const live: ActiveSession[] = [session('bob0924', 9n, '104.18.2.3:443', null)];
    expect(liveSessionCid(live, { username: 'bob0924', serverAddress: 'bench.work.avarok.net' })).toBe(9n);
  });

  it('takes the only live session with the username when the stored record names no server', () => {
    const live: ActiveSession[] = [session('bob0924', 9n, 'wss://bench.work.avarok.net/', 'bench.work.avarok.net')];
    expect(liveSessionCid(live, { username: 'bob0924', serverAddress: '' })).toBe(9n);
  });

  it('refuses to guess between two same-named sessions when the stored record names no server', () => {
    const live: ActiveSession[] = [
      session('sam', 1n, 'wss://acme.work.avarok.net/', 'acme.work.avarok.net'),
      session('sam', 2n, 'wss://bench.work.avarok.net/', 'bench.work.avarok.net'),
    ];
    expect(liveSessionCid(live, { username: 'sam', serverAddress: '' })).toBeUndefined();
  });
});
