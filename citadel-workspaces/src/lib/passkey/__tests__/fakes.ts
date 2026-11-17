/**
 * Test doubles for the two passkey ports, and nothing else.
 *
 * Why these two are doubled: they are the I/O boundaries (SBIO). The store is
 * the agent's LocalDB over a WebSocket; the authenticator is a Touch ID prompt
 * or a YubiKey behind navigator.credentials. Neither exists under vitest.
 * Everything between them -- HKDF, AES-GCM, CBOR, the record logic -- runs for
 * real, on real WebCrypto.
 *
 * The fake authenticator computes its PRF the way CTAP2 hmac-secret does:
 * HMAC-SHA-256 under a per-credential secret the "device" never reveals, over
 * the eval salt. So the same credential and salt always give the same output,
 * and a different credential gives a different one.
 */
import { type Bytes, bytesEqual, copyBytes, randomBytes, toBase64Url } from '../bytes';
import type {
  Assertion, AuthenticatorPort, CreateCeremony, CreatedCredential, GetCeremony,
} from '../authenticator';
import { PasskeyError } from '../authenticator';
import type { PasskeyStore } from '../repository';
import type { PasskeyDeps } from '../unlock';

const HMAC: 'HMAC' = 'HMAC';

export class MemoryStore implements PasskeyStore {
  readonly data: Map<string, Bytes> = new Map();
  async get(key: string): Promise<Bytes | null> { return this.data.get(key) ?? null; }
  async set(key: string, value: Bytes): Promise<void> { this.data.set(key, copyBytes(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
  async listKeys(prefix: string): Promise<string[]> { return [...this.data.keys()].filter((k) => k.startsWith(prefix)); }
}

/** What create() reports about PRF: evaluated at create, only on get, or not at all. */
export type PrfMode = 'on-create' | 'on-get-only' | 'none';

interface DeviceCredential { id: Bytes; secret: Bytes }

export class FakeAuthenticator implements AuthenticatorPort {
  readonly credentials: DeviceCredential[] = [];
  readonly createCalls: CreateCeremony[] = [];
  readonly getCalls: GetCeremony[] = [];
  readonly signalled: string[] = [];
  prfMode: PrfMode = 'on-create';
  /** When set, the user dismisses the next prompt. */
  cancelNext: boolean = false;
  /** When set, get() answers with this credential if it is allowed. */
  preferId: Bytes | null = null;
  /** The browser says it has no PRF at all (getClientCapabilities). */
  browserHasNoPrf: boolean = false;

  private async prf(secret: Bytes, salt: Bytes): Promise<Bytes> {
    const hmac: HmacImportParams = { name: HMAC, hash: 'SHA-256' };
    const key: CryptoKey = await crypto.subtle.importKey('raw', secret, hmac, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign(HMAC, key, salt));
  }

  private consumeCancel(): void {
    if (this.cancelNext) { this.cancelNext = false; throw new PasskeyError('cancelled'); }
  }

  async create(c: CreateCeremony): Promise<CreatedCredential> {
    this.createCalls.push(c);
    this.consumeCancel();
    const device: DeviceCredential = { id: randomBytes(16), secret: randomBytes(32) };
    this.credentials.push(device);
    return {
      credentialId: device.id, transports: ['internal'], publicKeySpki: randomBytes(91),
      publicKeyAlgorithm: -7, attestationObject: randomBytes(64),
      prf: {
        enabled: this.prfMode === 'none' ? undefined : true,
        first: this.prfMode === 'on-create' ? await this.prf(device.secret, c.prfSalt) : null,
      },
    };
  }

  async get(c: GetCeremony): Promise<Assertion> {
    this.getCalls.push(c);
    this.consumeCancel();
    const allowed: GetCeremony['allow'] = c.allow.filter((a) => this.credentials.some((d) => bytesEqual(d.id, a.id)));
    const pick: GetCeremony['allow'][number] | undefined =
      allowed.find((a) => this.preferId && bytesEqual(a.id, this.preferId)) ?? allowed[0];
    if (!pick) throw new PasskeyError('cancelled');
    const device: DeviceCredential = this.credentials.find((d) => bytesEqual(d.id, pick.id)) as DeviceCredential;
    return {
      credentialId: device.id,
      prfFirst: this.prfMode === 'none' ? null : await this.prf(device.secret, pick.prfSalt),
    };
  }

  async prfRuledOut(): Promise<boolean> {
    return this.browserHasNoPrf;
  }

  async signalUnknownCredential(_rpId: string, credentialId: Bytes): Promise<void> {
    this.signalled.push(toBase64Url(credentialId));
  }
}

export function testDeps(): PasskeyDeps & { store: MemoryStore; authenticator: FakeAuthenticator } {
  let clock: number = 1_700_000_000_000;
  return {
    store: new MemoryStore(),
    authenticator: new FakeAuthenticator(),
    // A fixed test RP ID: the value only has to be consistent within a test.
    rpId: 'work.avarok.net',
    rpName: 'Citadel Workspace',
    now: (): number => (clock += 1000),
  };
}
