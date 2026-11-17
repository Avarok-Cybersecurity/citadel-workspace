// @vitest-environment node
/**
 * The envelope, on real WebCrypto: a KEK from the PRF output wraps the DEK, the
 * DEK seals the password, and nothing opens under the wrong key, the wrong
 * binding, or a flipped bit.
 */
import { describe, it, expect } from 'vitest';
import { type Bytes, randomBytes } from '../bytes';
import {
  type AccountBinding, type CredentialBinding, type Sealed, EnvelopeError,
  deriveKek, generateDek, openPassword, sealPassword, unwrapDek, wrapDek,
} from '../envelope';

const account: AccountBinding = { rpId: 'work.avarok.net', username: 'alice', cid: 12345678901234567890n };
const cred = (id: Bytes): CredentialBinding => ({ ...account, credentialId: id });

async function sealed(prf: Bytes, binding: CredentialBinding): Promise<{ wrapped: Sealed; password: Sealed }> {
  const dek: CryptoKey = await generateDek();
  return {
    wrapped: await wrapDek(dek, await deriveKek(prf, binding), binding),
    password: await sealPassword('correct horse battery staple', dek, binding),
  };
}

async function open(prf: Bytes, binding: CredentialBinding, s: { wrapped: Sealed; password: Sealed }): Promise<string> {
  const dek: CryptoKey = await unwrapDek(s.wrapped, await deriveKek(prf, binding), binding, false);
  return openPassword(s.password, dek, binding);
}

const flip = (b: Bytes, at: number): Bytes => { const c: Bytes = new Uint8Array(b); c[at] ^= 0x01; return c; };

describe('the passkey envelope', () => {
  it('wraps and unwraps: the password comes back from the PRF output alone', async () => {
    const prf: Bytes = randomBytes(32);
    const binding: CredentialBinding = cred(randomBytes(16));
    expect(await open(prf, binding, await sealed(prf, binding))).toBe('correct horse battery staple');
  });

  it('uses a fresh 96-bit IV for every seal', async () => {
    const prf: Bytes = randomBytes(32);
    const binding: CredentialBinding = cred(randomBytes(16));
    const a: { wrapped: Sealed; password: Sealed } = await sealed(prf, binding);
    const b: { wrapped: Sealed; password: Sealed } = await sealed(prf, binding);
    expect(a.password.iv.byteLength).toBe(12);
    expect(a.password.iv).not.toEqual(b.password.iv);
    expect(a.wrapped.iv).not.toEqual(a.password.iv);
  });

  it('refuses a wrong PRF output', async () => {
    const binding: CredentialBinding = cred(randomBytes(16));
    const s: { wrapped: Sealed; password: Sealed } = await sealed(randomBytes(32), binding);
    await expect(open(randomBytes(32), binding, s)).rejects.toBeInstanceOf(EnvelopeError);
  });

  it('refuses a PRF output of the wrong length', async () => {
    await expect(deriveKek(randomBytes(31), cred(randomBytes(16)))).rejects.toBeInstanceOf(EnvelopeError);
  });

  it.each([
    ['the wrapped DEK ciphertext', (s: { wrapped: Sealed; password: Sealed }): void => { s.wrapped.ciphertext = flip(s.wrapped.ciphertext, 0); }],
    ['the wrapped DEK tag', (s: { wrapped: Sealed; password: Sealed }): void => { s.wrapped.ciphertext = flip(s.wrapped.ciphertext, s.wrapped.ciphertext.byteLength - 1); }],
    ['the wrapped DEK IV', (s: { wrapped: Sealed; password: Sealed }): void => { s.wrapped.iv = flip(s.wrapped.iv, 3); }],
    ['the password ciphertext', (s: { wrapped: Sealed; password: Sealed }): void => { s.password.ciphertext = flip(s.password.ciphertext, 0); }],
    ['the password tag', (s: { wrapped: Sealed; password: Sealed }): void => { s.password.ciphertext = flip(s.password.ciphertext, s.password.ciphertext.byteLength - 1); }],
    ['the password IV', (s: { wrapped: Sealed; password: Sealed }): void => { s.password.iv = flip(s.password.iv, 11); }],
  ])('refuses a flipped bit in %s', async (_what, tamper) => {
    const prf: Bytes = randomBytes(32);
    const binding: CredentialBinding = cred(randomBytes(16));
    const s: { wrapped: Sealed; password: Sealed } = await sealed(prf, binding);
    tamper(s);
    await expect(open(prf, binding, s)).rejects.toBeInstanceOf(EnvelopeError);
  });

  it.each([
    ['another account (cid)', (b: CredentialBinding): CredentialBinding => ({ ...b, cid: b.cid + 1n })],
    ['another username', (b: CredentialBinding): CredentialBinding => ({ ...b, username: 'mallory' })],
    ['another RP ID', (b: CredentialBinding): CredentialBinding => ({ ...b, rpId: 'evil.example' })],
    ['another credential', (b: CredentialBinding): CredentialBinding => ({ ...b, credentialId: randomBytes(16) })],
  ])('refuses a record moved to %s', async (_what, move) => {
    const prf: Bytes = randomBytes(32);
    const binding: CredentialBinding = cred(randomBytes(16));
    await expect(open(prf, move(binding), await sealed(prf, binding))).rejects.toBeInstanceOf(EnvelopeError);
  });

  it('lets two credentials each unwrap the same DEK', async () => {
    const dek: CryptoKey = await generateDek();
    const one: CredentialBinding = cred(randomBytes(16));
    const two: CredentialBinding = cred(randomBytes(16));
    const prfOne: Bytes = randomBytes(32);
    const prfTwo: Bytes = randomBytes(32);
    const password: Sealed = await sealPassword('shared secret', dek, account);
    const wrappedOne: Sealed = await wrapDek(dek, await deriveKek(prfOne, one), one);
    const wrappedTwo: Sealed = await wrapDek(dek, await deriveKek(prfTwo, two), two);

    const viaOne: CryptoKey = await unwrapDek(wrappedOne, await deriveKek(prfOne, one), one, false);
    const viaTwo: CryptoKey = await unwrapDek(wrappedTwo, await deriveKek(prfTwo, two), two, false);
    expect(await openPassword(password, viaOne, account)).toBe('shared secret');
    expect(await openPassword(password, viaTwo, account)).toBe('shared secret');
    await expect(unwrapDek(wrappedTwo, await deriveKek(prfOne, two), two, false)).rejects.toBeInstanceOf(EnvelopeError);
  });

  it('keeps the KEK and a sign-in DEK non-extractable', async () => {
    const prf: Bytes = randomBytes(32);
    const binding: CredentialBinding = cred(randomBytes(16));
    const kek: CryptoKey = await deriveKek(prf, binding);
    const s: { wrapped: Sealed; password: Sealed } = await sealed(prf, binding);
    expect(kek.extractable).toBe(false);
    expect((await unwrapDek(s.wrapped, kek, binding, false)).extractable).toBe(false);
  });
});
