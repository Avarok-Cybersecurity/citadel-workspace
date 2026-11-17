/**
 * A hosted session is recognised as belonging to the address the user stored.
 *
 * The session below is exactly what the live agent reported for bench: `server_address`
 * is how it dialled, `server_host` what was typed. The UI stores what was typed. Compared
 * with `===` they never matched, in eight places.
 */
import { describe, it, expect } from 'vitest';
import { sessionIsOnServer, type SessionServer } from '../same-server';

const hosted: SessionServer = { server_address: 'wss://bench.work.avarok.net/', server_host: 'bench.work.avarok.net' };

describe('sessionIsOnServer', () => {
  it('matches a hosted session by the host it was typed as', () => {
    expect(sessionIsOnServer(hosted, 'bench.work.avarok.net')).toBe(true);
    expect(sessionIsOnServer(hosted, ' Bench.Work.Avarok.net ')).toBe(true);
  });

  it('does not match a different hosted workspace behind the same edge', () => {
    expect(sessionIsOnServer(hosted, 'acme.work.avarok.net')).toBe(false);
  });

  it('matches a self-hosted server with or without the assumed port', () => {
    const selfHosted: SessionServer = { server_address: '10.0.0.5:12400', server_host: 'citadel.example.com:12400' };
    expect(sessionIsOnServer(selfHosted, 'citadel.example.com')).toBe(true);
    expect(sessionIsOnServer(selfHosted, 'citadel.example.com:12400')).toBe(true);
  });

  it('falls back to server_address for an agent older than server_host', () => {
    expect(sessionIsOnServer({ server_address: 'citadel.example.com:12400' }, 'citadel.example.com')).toBe(true);
    expect(sessionIsOnServer({ server_address: 'citadel.example.com:12400', server_host: null }, 'other.example.com')).toBe(false);
  });

  it('matches a hosted session whose agent sent no server_host, by the host it dialled', () => {
    // Measured live: a session the agent re-created carried only the dialled URL, and the
    // switcher reported "Session CID not available" for an account the agent was holding.
    const dialledOnly: SessionServer = { server_address: 'wss://bench.work.avarok.net/', server_host: null };
    expect(sessionIsOnServer(dialledOnly, 'bench.work.avarok.net')).toBe(true);
    expect(sessionIsOnServer(dialledOnly, 'acme.work.avarok.net')).toBe(false);
  });

  it('keeps a non-default port in a dialled URL significant', () => {
    const dialled: SessionServer = { server_address: 'wss://citadel.example.com:8443/', server_host: null };
    expect(sessionIsOnServer(dialled, 'citadel.example.com:8443')).toBe(true);
    expect(sessionIsOnServer(dialled, 'citadel.example.com:9443')).toBe(false);
  });
});
