// @vitest-environment node
/**
 * Enrol, sign in, add a second key, remove keys -- through the real envelope,
 * codec and repository, with only the two ports doubled (see fakes.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import { type Bytes, bytesEqual } from '../bytes';
import { failureOf } from '../authenticator';
import { enrolCredential } from './legacy-enrol';
import { signInWithPasskey, unlockAccount } from '../unlock';
import type { CredentialRecord } from '../records';
import {
  accountKey, credentialKey, hasPasskeyLogin, listCredentials, loadAccount, removeCredential,
} from '../repository';
import { testDeps } from './fakes';

type Deps = ReturnType<typeof testDeps>;
const PASSWORD: string = 'correct horse battery staple';
const ALICE: { username: string; cid: bigint } = { username: 'alice', cid: 42n };

const enrolFirst = (deps: Deps, label: string = 'MacBook'): Promise<CredentialRecord> =>
  enrolCredential(deps, { ...ALICE, label, password: PASSWORD });

async function failure(promise: Promise<unknown>): Promise<string> {
  try { await promise; } catch (error) { return failureOf(error); }
  return 'resolved';
}

describe('enrolling a passkey', () => {
  it('writes an account and a credential record that sign-in opens', async () => {
    const deps: Deps = testDeps();
    const record: CredentialRecord = await enrolFirst(deps);
    expect(deps.store.data.has(accountKey(deps.rpId, 'alice'))).toBe(true);
    expect(deps.store.data.has(credentialKey(deps.rpId, 'alice', record.credentialId))).toBe(true);
    expect((await unlockAccount(deps, 'alice', false)).password).toBe(PASSWORD);
  });

  it('never writes the password in the clear', async () => {
    const deps: Deps = testDeps();
    await enrolFirst(deps);
    const needle: Bytes = new TextEncoder().encode(PASSWORD) as Bytes;
    for (const bytes of deps.store.data.values()) {
      const hay: string = Array.from(bytes).join(',');
      expect(hay.includes(Array.from(needle).join(','))).toBe(false);
    }
  });

  it('asks for UV-backed PRF with a random salt per record and keeps the public key', async () => {
    const deps: Deps = testDeps();
    const one: CredentialRecord = await enrolFirst(deps);
    const two: CredentialRecord = await enrolCredential(deps, { ...ALICE, label: 'YubiKey', password: null });
    expect(one.prfSalt.byteLength).toBe(32);
    expect(bytesEqual(one.prfSalt, two.prfSalt)).toBe(false);
    expect(one.publicKeySpki?.byteLength).toBe(91);
    expect(one.attestationObject.byteLength).toBeGreaterThan(0);
    // The second create() excluded the first key.
    expect(bytesEqual(deps.authenticator.createCalls[1].excludeCredentialIds[0], one.credentialId)).toBe(true);
  });

  it('accepts a provider that evaluates PRF only on get()', async () => {
    const deps: Deps = testDeps();
    deps.authenticator.prfMode = 'on-get-only';
    await enrolFirst(deps);
    expect(deps.authenticator.getCalls).toHaveLength(1);
    expect((await unlockAccount(deps, 'alice', false)).password).toBe(PASSWORD);
  });

  it('without PRF writes nothing, forgets the orphan key, and offers the password only', async () => {
    const deps: Deps = testDeps();
    deps.authenticator.prfMode = 'none';
    expect(await failure(enrolFirst(deps))).toBe('unsupported');
    expect(deps.store.data.size).toBe(0);
    expect(deps.authenticator.signalled).toHaveLength(1);
    expect(await hasPasskeyLogin(deps.store, deps.rpId, 'alice')).toBe(false);
  });

  it('writes nothing when the prompt is cancelled', async () => {
    const deps: Deps = testDeps();
    deps.authenticator.cancelNext = true;
    expect(await failure(enrolFirst(deps))).toBe('cancelled');
    expect(deps.store.data.size).toBe(0);
  });

  it('writes nothing when the records it would write do not give the password back', async () => {
    const deps: Deps = testDeps();
    // A lone surrogate does not survive UTF-8: the sealed bytes open to U+FFFD.
    const result: string = await failure(enrolCredential(deps, { ...ALICE, label: 'x', password: 'pw\uD800' }));
    expect(result).toBe('failed');
    expect(deps.store.data.size).toBe(0);
  });
});

describe('several keys on one account', () => {
  it('lets each key unwrap the same data key, and removing one leaves the other', async () => {
    const deps: Deps = testDeps();
    const one: CredentialRecord = await enrolFirst(deps);
    const two: CredentialRecord = await enrolCredential(deps, { ...ALICE, label: 'YubiKey', password: null });
    expect((await listCredentials(deps.store, deps.rpId, 'alice')).map((c) => c.label)).toEqual(['MacBook', 'YubiKey']);

    for (const id of [one.credentialId, two.credentialId]) {
      deps.authenticator.preferId = id;
      const opened: { password: string; credential: CredentialRecord } = await unlockAccount(deps, 'alice', false);
      expect(bytesEqual(opened.credential.credentialId, id)).toBe(true);
      expect(opened.password).toBe(PASSWORD);
    }

    await removeCredential(deps.store, deps.rpId, 'alice', one.credentialId);
    expect(deps.store.data.has(credentialKey(deps.rpId, 'alice', one.credentialId))).toBe(false);
    deps.authenticator.preferId = two.credentialId;
    expect((await unlockAccount(deps, 'alice', false)).password).toBe(PASSWORD);
  });

  it('removing the last key removes the sealed password too', async () => {
    const deps: Deps = testDeps();
    const one: CredentialRecord = await enrolFirst(deps);
    await removeCredential(deps.store, deps.rpId, 'alice', one.credentialId);
    expect(deps.store.data.size).toBe(0);
    expect(await hasPasskeyLogin(deps.store, deps.rpId, 'alice')).toBe(false);
  });

  it('a second key without a password needs an enrolled key to open the envelope', async () => {
    const deps: Deps = testDeps();
    expect(await failure(enrolCredential(deps, { ...ALICE, label: 'x', password: null }))).toBe('not-set-up-here');
  });
});

describe('signing in with a passkey', () => {
  it('passes the decrypted password to the existing login call', async () => {
    const deps: Deps = testDeps();
    await enrolFirst(deps);
    const login: ReturnType<typeof vi.fn> = vi.fn(async (): Promise<void> => undefined);
    await signInWithPasskey(deps, 'alice', login);
    expect(login).toHaveBeenCalledExactlyOnceWith('alice', PASSWORD);
    // Read-only since option A was retired: nothing is written back.
    expect((await listCredentials(deps.store, deps.rpId, 'alice'))[0].lastUsedAt).toBeNull();
  });

  it('asks only for this account\'s keys, with UV and each key\'s own salt', async () => {
    const deps: Deps = testDeps();
    const one: CredentialRecord = await enrolFirst(deps);
    await signInWithPasskey(deps, 'alice', vi.fn(async (): Promise<void> => undefined));
    const call: typeof deps.authenticator.getCalls[number] = deps.authenticator.getCalls.at(-1)!;
    expect(call.allow).toHaveLength(1);
    expect(bytesEqual(call.allow[0].prfSalt, one.prfSalt)).toBe(true);
  });

  it('does not call login for an account with no keys here', async () => {
    const deps: Deps = testDeps();
    const login: ReturnType<typeof vi.fn> = vi.fn();
    expect(await failure(signInWithPasskey(deps, 'alice', login))).toBe('not-set-up-here');
    expect(login).not.toHaveBeenCalled();
  });

  it('treats a tampered record as absent and does not call login', async () => {
    const deps: Deps = testDeps();
    const one: CredentialRecord = await enrolFirst(deps);
    const key: string = credentialKey(deps.rpId, 'alice', one.credentialId);
    const bytes: Bytes = deps.store.data.get(key)!;
    // Flip one byte inside the wrapped DEK (it is the last field encoded).
    bytes[bytes.byteLength - 1] ^= 0x01;
    const login: ReturnType<typeof vi.fn> = vi.fn();
    expect(await failure(signInWithPasskey(deps, 'alice', login))).toBe('not-set-up-here');
    expect(login).not.toHaveBeenCalled();
  });

  it('falls back when the user cancels, without calling login', async () => {
    const deps: Deps = testDeps();
    await enrolFirst(deps);
    deps.authenticator.cancelNext = true;
    const login: ReturnType<typeof vi.fn> = vi.fn();
    expect(await failure(signInWithPasskey(deps, 'alice', login))).toBe('cancelled');
    expect(login).not.toHaveBeenCalled();
  });

  it('does not take another user\'s records copied under this username', async () => {
    const deps: Deps = testDeps();
    const one: CredentialRecord = await enrolFirst(deps);
    deps.store.data.set(accountKey(deps.rpId, 'mallory'), deps.store.data.get(accountKey(deps.rpId, 'alice'))!);
    deps.store.data.set(
      credentialKey(deps.rpId, 'mallory', one.credentialId),
      deps.store.data.get(credentialKey(deps.rpId, 'alice', one.credentialId))!,
    );
    expect(await loadAccount(deps.store, deps.rpId, 'mallory')).toBeNull();
    expect(await listCredentials(deps.store, deps.rpId, 'mallory')).toEqual([]);
    expect(await hasPasskeyLogin(deps.store, deps.rpId, 'mallory')).toBe(false);
  });
});
