/**
 * The options the browser is handed carry the security decisions: user
 * verification required, a discoverable credential, PRF requested with this
 * record's salt, existing keys excluded. Asserted here rather than trusted.
 *
 * The CredentialsContainer double is the browser's own boundary: vitest has no
 * authenticator, and the adapter's job is exactly the mapping tested below.
 */
import { describe, it, expect } from 'vitest';
import { type Bytes, randomBytes, toBase64Url } from '../bytes';
import { failureOf } from '../authenticator';
import { buildCreationOptions, buildRequestOptions, createBrowserAuthenticator } from '../browser-authenticator';
import { resolveRpId } from '../rp-id';

const salt: Bytes = randomBytes(32);
const existing: Bytes = randomBytes(16);

describe('WebAuthn options', () => {
  it('create() requires UV and a resident key, requests PRF, and excludes enrolled keys', () => {
    const o: PublicKeyCredentialCreationOptions = buildCreationOptions({
      rpId: 'work.avarok.net', rpName: 'Citadel Workspace', userHandle: randomBytes(16),
      userName: 'alice', userDisplayName: 'alice', challenge: randomBytes(32),
      excludeCredentialIds: [existing], prfSalt: salt,
    });
    expect(o.rp.id).toBe('work.avarok.net');
    expect(o.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(o.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -8, -257]);
    expect(o.extensions?.prf?.eval?.first).toBe(salt);
    expect(o.excludeCredentials?.[0].id).toBe(existing);
  });

  it('get() requires UV and evaluates each allowed key with its own salt', () => {
    const o: PublicKeyCredentialRequestOptions = buildRequestOptions({
      rpId: 'work.avarok.net', challenge: randomBytes(32),
      allow: [{ id: existing, transports: ['usb'], prfSalt: salt }],
    });
    expect(o.userVerification).toBe('required');
    expect(o.allowCredentials?.[0]).toMatchObject({ id: existing, transports: ['usb'] });
    expect(o.extensions?.prf?.evalByCredential?.[toBase64Url(existing)]?.first).toBe(salt);
  });
});

describe('the browser adapter', () => {
  const failing = (name: string): CredentialsContainer => ({
    create: async (): Promise<Credential | null> => { throw new DOMException('x', name); },
    get: async (): Promise<Credential | null> => { throw new DOMException('x', name); },
  } as unknown as CredentialsContainer);
  const ceremony: { rpId: string; challenge: Bytes; allow: { id: Bytes; transports: string[]; prfSalt: Bytes }[] } =
    { rpId: 'localhost', challenge: randomBytes(32), allow: [{ id: existing, transports: [], prfSalt: salt }] };

  it.each([
    ['NotAllowedError', 'cancelled'],
    ['AbortError', 'cancelled'],
    ['SecurityError', 'unsupported'],
    ['UnknownError', 'failed'],
  ])('maps %s to %s', async (name, expected) => {
    const port: ReturnType<typeof createBrowserAuthenticator> = createBrowserAuthenticator(failing(name), null);
    let got: string = 'resolved';
    try { await port.get(ceremony); } catch (error) { got = failureOf(error); }
    expect(got).toBe(expected);
  });
});

describe('the PRF pre-check', () => {
  // The browser's own static (PublicKeyCredential.getClientCapabilities) is the seam doubled here.
  const ruledOut = (capabilities: (() => Promise<Record<string, boolean>>) | null): Promise<boolean> =>
    createBrowserAuthenticator(navigator.credentials, capabilities).prfRuledOut();

  it('rules PRF out only when the browser says it has none', async () => {
    expect(await ruledOut(async () => ({ 'extension:prf': false }))).toBe(true);
  });

  it.each([
    ['says it has PRF', async (): Promise<Record<string, boolean>> => ({ 'extension:prf': true })],
    ['does not say', async (): Promise<Record<string, boolean>> => ({})],
    ['cannot be asked', async (): Promise<Record<string, boolean>> => { throw new DOMException('x', 'NotSupportedError'); }],
  ])('leaves it to the ceremony when the browser %s', async (_case, capabilities) => {
    expect(await ruledOut(capabilities)).toBe(false);
  });

  it('leaves it to the ceremony in a browser without getClientCapabilities', async () => {
    expect(await ruledOut(null)).toBe(false);
  });
});

describe('the RP ID', () => {
  it('is work.avarok.net on that host, and the page host elsewhere', () => {
    expect(resolveRpId('work.avarok.net')).toBe('work.avarok.net');
    expect(resolveRpId('acme.work.avarok.net')).toBe('work.avarok.net');
    expect(resolveRpId('localhost')).toBe('localhost');
    expect(resolveRpId('notwork.avarok.net')).toBe('notwork.avarok.net');
  });
});
