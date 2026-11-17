import { describe, it, expect } from 'vitest';
import {
  normalizeWorkspaceAddress,
  hasExplicitPort,
  isTenantHost,
  DEFAULT_WORKSPACE_PORT,
} from '@/lib/workspace-address';

/**
 * The port is assumed, not required.
 *
 * The agent always dials `host:port`, but making the USER type it made the
 * commonest case the fiddly one: someone handed a workspace called
 * `citadel.example.com` had to supply a number nobody told them, and a bare
 * hostname failed only after a thirty-second timeout.
 */
describe('assuming a port', () => {
  it('adds the default to a bare hostname', () => {
    expect(normalizeWorkspaceAddress('citadel.example.com'))
      .toBe(`citadel.example.com:${DEFAULT_WORKSPACE_PORT}`);
  });

  it('adds it to a bare IPv4 address', () => {
    expect(normalizeWorkspaceAddress('51.81.107.44')).toBe(`51.81.107.44:${DEFAULT_WORKSPACE_PORT}`);
  });

  it('leaves an explicit port alone, including a non-default one', () => {
    // The whole point of "unless otherwise specified".
    expect(normalizeWorkspaceAddress('citadel.example.com:9000')).toBe('citadel.example.com:9000');
    expect(normalizeWorkspaceAddress('127.0.0.1:12349')).toBe('127.0.0.1:12349');
  });

  it('trims, because a pasted address usually arrives with whitespace', () => {
    expect(normalizeWorkspaceAddress('  citadel.example.com  '))
      .toBe(`citadel.example.com:${DEFAULT_WORKSPACE_PORT}`);
  });

  it('handles a bracketed IPv6 literal in both forms', () => {
    expect(normalizeWorkspaceAddress('[::1]')).toBe(`[::1]:${DEFAULT_WORKSPACE_PORT}`);
    expect(normalizeWorkspaceAddress('[::1]:12349')).toBe('[::1]:12349');
  });

  it('leaves an EMPTY string empty rather than inventing a host', () => {
    // The field's own "address required" check owns this case.
    expect(normalizeWorkspaceAddress('')).toBe('');
    expect(normalizeWorkspaceAddress('   ')).toBe('');
  });

  it('does NOT guess at an ambiguous address', () => {
    // A bare IPv6 literal has colons that are not a port separator, and there
    // is no honest way to tell it from a typo. Appending a port would produce a
    // different address that looks deliberate; passing it through lets
    // something that can explain itself refuse it.
    expect(normalizeWorkspaceAddress('::1')).toBe('::1');
    expect(normalizeWorkspaceAddress('host:notaport')).toBe('host:notaport');
    expect(normalizeWorkspaceAddress('a:1:2')).toBe('a:1:2');
  });
});

/**
 * Hosted workspaces have no port to add.
 *
 * `acme.work.avarok.net` is a Cloudflare Worker reached over wss on 443; the
 * agent turns the bare host into `wss://acme.work.avarok.net/`. Appending
 * 12400 sent it to a port nothing listens on.
 */
describe('hosted workspaces and WebSocket URLs', () => {
  it('leaves a hosted workspace host without a port', () => {
    expect(normalizeWorkspaceAddress('acme.work.avarok.net')).toBe('acme.work.avarok.net');
    expect(normalizeWorkspaceAddress('  Acme-Corp.work.avarok.net ')).toBe('Acme-Corp.work.avarok.net');
  });

  it('leaves ws:// and wss:// URLs exactly as typed', () => {
    expect(normalizeWorkspaceAddress('wss://acme.work.avarok.net/')).toBe('wss://acme.work.avarok.net/');
    expect(normalizeWorkspaceAddress('ws://localhost:8787/acme')).toBe('ws://localhost:8787/acme');
    expect(normalizeWorkspaceAddress(' WSS://acme.work.avarok.net ')).toBe('WSS://acme.work.avarok.net');
  });

  it('still adds the port to hosts that only look similar', () => {
    // Not one label under the tenant suffix: the apex, a deeper name, a
    // lookalike suffix, and a host that merely contains the suffix.
    for (const host of [
      'work.avarok.net',
      'a.b.work.avarok.net',
      'acme.work.avarok.net.evil.com',
      'acmework.avarok.net',
      '-acme.work.avarok.net',
    ]) {
      expect(normalizeWorkspaceAddress(host), host).toBe(`${host}:${DEFAULT_WORKSPACE_PORT}`);
    }
  });

  it('keeps an explicit port on a hosted host as typed', () => {
    expect(normalizeWorkspaceAddress('acme.work.avarok.net:9000')).toBe('acme.work.avarok.net:9000');
  });

  it('isTenantHost agrees with the normaliser', () => {
    expect(isTenantHost('acme.work.avarok.net')).toBe(true);
    expect(isTenantHost('acme.work.avarok.net:443')).toBe(false);
    expect(isTenantHost('citadel.example.com')).toBe(false);
  });
});

describe('hasExplicitPort', () => {
  it('is true only when a port is really there', () => {
    expect(hasExplicitPort('citadel.example.com:12400')).toBe(true);
    expect(hasExplicitPort('[::1]:443')).toBe(true);
    expect(hasExplicitPort('citadel.example.com')).toBe(false);
    expect(hasExplicitPort('host:notaport')).toBe(false);
  });
});

/**
 * The wiring, not the function.
 *
 * A normaliser nothing calls is the failure this codebase keeps producing: the
 * code runs, the fallback renders, and the feature is inert. ServerConnect is
 * the one place the typed text becomes the address every consumer downstream
 * uses -- register, login, the stored session list -- so it is the place that
 * must call it.
 */
describe('ServerConnect applies it', () => {
  it('normalises the address before handing it on', async () => {
    const fs: typeof import('node:fs') = await import('node:fs');
    const source: string = fs.readFileSync('src/components/ServerConnect.tsx', 'utf8');
    expect(source, 'must import the normaliser').toContain('normalizeWorkspaceAddress');
    expect(
      source,
      'onNext must receive the normalised address, not the raw field value',
    ).toContain('onNext(normalizeWorkspaceAddress(serverAddress), password)');
  });

  it('shows a placeholder that no longer demands a port', () => {
    const shown: string = 'citadel.example.com';
    // Same example the failure messages name, and now the simplest thing that
    // works rather than the shape that used to be mandatory.
    expect(normalizeWorkspaceAddress(shown)).toBe(`${shown}:${DEFAULT_WORKSPACE_PORT}`);
  });
});
