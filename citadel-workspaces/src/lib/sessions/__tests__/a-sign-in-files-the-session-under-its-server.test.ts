/**
 * A sign-in files its session under the server the agent reports, and keeps the name.
 *
 * Measured live: a takeover sign-in stored `serverAddress: ''` and `fullName: 'bob0924'`
 * into the agent-wide list, and the switcher could not reach the account afterwards.
 */
import { describe, it, expect } from 'vitest';
import { sessionLabel } from '../session-label';
import type { ActiveSession, StoredSession } from '@/types/session-types';

const live: ActiveSession[] = [
  { cid: 7n, username: 'bob0924', server_address: 'wss://bench.work.avarok.net/', server_host: 'bench.work.avarok.net', peer_connections: {} },
  { cid: 8n, username: 'eve0924', server_address: 'wss://acme.work.avarok.net/', server_host: null, peer_connections: {} },
] as unknown as ActiveSession[];

const stored: StoredSession = { username: 'bob0924', serverAddress: 'old.work.avarok.net', fullName: 'Bob Brown', lastConnected: 1 } as StoredSession;

describe('sessionLabel', () => {
  it('uses the server the agent reports for the authenticated CID', () => {
    expect(sessionLabel(7n, 'bob0924', live, undefined).serverAddress).toBe('bench.work.avarok.net');
  });

  it('reads the dialled host when the agent sent no server_host', () => {
    expect(sessionLabel(8n, 'eve0924', live, undefined).serverAddress).toBe('acme.work.avarok.net');
  });

  it('prefers the live server to a stored copy', () => {
    expect(sessionLabel(7n, 'bob0924', live, stored).serverAddress).toBe('bench.work.avarok.net');
  });

  it('falls back to the stored server when the agent does not list the CID', () => {
    expect(sessionLabel(99n, 'bob0924', live, stored).serverAddress).toBe('old.work.avarok.net');
  });

  it('keeps the stored full name instead of replacing it with the handle', () => {
    expect(sessionLabel(7n, 'bob0924', live, stored).fullName).toBe('Bob Brown');
    expect(sessionLabel(7n, 'bob0924', live, undefined).fullName).toBe('bob0924');
  });
});
