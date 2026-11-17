/**
 * A hostname is handed to the agent, not resolved in the page.
 *
 * `resolveServerAddress` used to fetch `https://dns.google/resolve` for any
 * address that was not already an IP. A hosted UI's own Content-Security-Policy
 * refuses that connection — `connect-src` lists the page's origin and the
 * loopback agent and nothing else — so on work.avarok.net **every hostname
 * address failed** with a 30-second "Registration timed out" while a raw IP
 * worked. Measured against the live deployment:
 *
 *   Refused to connect to 'https://dns.google/resolve?name=citadel.avarok.net…'
 *   because it violates the document's Content Security Policy.
 *
 * And where the fetch did succeed it disclosed to Google which server each user
 * was joining.
 *
 * `Register.server_addr` is a string on the wire, and the agent resolves it with
 * `lookup_host`. So the page's job is to normalise the port and pass the name
 * through.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveServerAddress, DEFAULT_PORT } from '../address-resolver';

afterEach((): void => { vi.unstubAllGlobals(); });

describe('resolving a server address for Register', () => {
  it('passes a hostname through, with its port', async () => {
    await expect(resolveServerAddress('citadel.avarok.net:12400'))
      .resolves.toBe('citadel.avarok.net:12400');
  });

  it('supplies the default port when the address has none', async () => {
    await expect(resolveServerAddress('citadel.avarok.net'))
      .resolves.toBe(`citadel.avarok.net:${DEFAULT_PORT}`);
  });

  it('makes no network request at all', async () => {
    // The point of the change. A `fetch` here is the CSP violation, and it is
    // also the disclosure — so this asserts the ABSENCE of the call, with the
    // stub proving the assertion could fail.
    const fetchSpy: ReturnType<typeof vi.fn> = vi.fn((): never => { throw new Error('resolveServerAddress must not fetch'); });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(resolveServerAddress('citadel.avarok.net:12400')).resolves.toBeTruthy();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still normalises an IP address', async () => {
    // Discrimination control: an implementation that returned its input
    // unchanged would satisfy the first case and drop the default port here.
    await expect(resolveServerAddress('51.81.107.44')).resolves.toBe(`51.81.107.44:${DEFAULT_PORT}`);
    await expect(resolveServerAddress('51.81.107.44:12400')).resolves.toBe('51.81.107.44:12400');
  });
});
