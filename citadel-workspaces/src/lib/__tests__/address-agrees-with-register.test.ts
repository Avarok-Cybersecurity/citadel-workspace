/**
 * An address compares (sameAddress) as Register sends it (resolveServerAddress).
 *
 * The two assumed different default ports -- 12400 for the address field, 12349 for the
 * resolver -- so a bare `citadel.example.com` registered as :12349 and compared as :12400:
 * the join form's held-username check called the same server another one. One default now
 * (DEFAULT_WORKSPACE_PORT).
 */
import { describe, expect, it } from 'vitest';
import { resolveServerAddress } from '../address-resolver';
import { sameAddress } from '../sessions/same-server';
import { DEFAULT_WORKSPACE_PORT, normalizeWorkspaceAddress } from '../workspace-address';

const TYPED: readonly string[] = [
  'citadel.example.com', 'citadel.example.com:9000', '10.0.0.7', '10.0.0.7:12349', '[::1]:12400',
  'acme.work.avarok.net', 'wss://acme.work.avarok.net/', 'localhost',
];

describe('an address and what Register sends for it', () => {
  it.each(TYPED)('%s is the same server either way', async (typed: string) => {
    expect(sameAddress(typed, await resolveServerAddress(typed))).toBe(true);
  });

  it('a bare host gets the one default port in both', async () => {
    expect(await resolveServerAddress('citadel.example.com')).toBe(`citadel.example.com:${DEFAULT_WORKSPACE_PORT}`);
    expect(normalizeWorkspaceAddress('citadel.example.com')).toBe(`citadel.example.com:${DEFAULT_WORKSPACE_PORT}`);
  });
});
