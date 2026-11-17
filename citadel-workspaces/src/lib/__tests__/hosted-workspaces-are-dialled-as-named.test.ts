/**
 * What Register sends for a hosted workspace is what the agent needs to reach it.
 *
 * Measured on the live site: joining `bench.work.avarok.net` sent
 * `bench.work.avarok.net:12349`, the agent dialled the Cloudflare edge over raw TCP, and
 * registration timed out. The agent turns a BARE tenant host into `wss://<host>/`
 * (server_address.rs) and dials a ws(s) URL as given, so both must reach it untouched.
 */
import { describe, it, expect } from 'vitest';
import { resolveServerAddress } from '../address-resolver';

describe('resolveServerAddress', () => {
  it('passes a hosted workspace host through without a port', async () => {
    expect(await resolveServerAddress('bench.work.avarok.net')).toBe('bench.work.avarok.net');
    expect(await resolveServerAddress('  acme-corp.work.avarok.net ')).toBe('acme-corp.work.avarok.net');
  });

  it('passes a WebSocket URL through exactly', async () => {
    expect(await resolveServerAddress('wss://bench.work.avarok.net/bench')).toBe('wss://bench.work.avarok.net/bench');
    expect(await resolveServerAddress('ws://localhost:8080/')).toBe('ws://localhost:8080/');
  });

  it('still gives a self-hosted server its socket port', async () => {
    expect(await resolveServerAddress('example.com')).toBe('example.com:12400');
    expect(await resolveServerAddress('work.avarok.net')).toBe('work.avarok.net:12400');
    expect(await resolveServerAddress('a.b.work.avarok.net')).toBe('a.b.work.avarok.net:12400');
  });
});
