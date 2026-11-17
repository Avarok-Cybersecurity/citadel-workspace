// @vitest-environment node
/**
 * The stored records are CBOR, versioned, and carry the CID as a bigint. A
 * record of another version, another kind, or a JSON-era shape decodes to
 * null -- absent -- rather than to a half-filled object.
 */
import { describe, it, expect } from 'vitest';
import { encode as cborEncode } from 'cbor-x';
import { randomBytes } from '../bytes';
import {
  type AccountRecord, type CredentialRecord, RECORD_VERSION,
  decodeAccountRecord, decodeCredentialRecord, encodeAccountRecord, encodeCredentialRecord,
} from '../records';

const account: AccountRecord = {
  v: RECORD_VERSION, kind: 'account', rpId: 'work.avarok.net', username: 'alice',
  cid: 18446744073709551615n, userHandle: randomBytes(16), passwordIv: randomBytes(12),
  sealedPassword: randomBytes(40), createdAt: 1, updatedAt: 2,
};

const credential: CredentialRecord = {
  v: RECORD_VERSION, kind: 'credential', rpId: 'work.avarok.net', username: 'alice', cid: 7n,
  credentialId: randomBytes(16), label: 'YubiKey', createdAt: 3, lastUsedAt: null,
  transports: ['usb', 'nfc'], publicKeySpki: null, publicKeyAlgorithm: -8,
  attestationObject: randomBytes(70), prfSalt: randomBytes(32), dekIv: randomBytes(12), wrappedDek: randomBytes(48),
};

describe('passkey record encoding', () => {
  it('round-trips an account record, bigint CID and version included', () => {
    const decoded: AccountRecord | null = decodeAccountRecord(encodeAccountRecord(account));
    expect(decoded).toEqual(account);
    expect(typeof decoded?.cid).toBe('bigint');
    expect(decoded?.v).toBe(1);
  });

  it('round-trips a credential record, including null fields', () => {
    expect(decodeCredentialRecord(encodeCredentialRecord(credential))).toEqual(credential);
    const used: CredentialRecord = { ...credential, lastUsedAt: 99, publicKeySpki: randomBytes(91) };
    expect(decodeCredentialRecord(encodeCredentialRecord(used))).toEqual(used);
  });

  it('refuses another version', () => {
    expect(decodeAccountRecord(cborEncode({ ...account, v: 2 }))).toBeNull();
    expect(decodeCredentialRecord(cborEncode({ ...credential, v: 0 }))).toBeNull();
  });

  it('refuses one kind read as the other', () => {
    expect(decodeAccountRecord(encodeCredentialRecord(credential))).toBeNull();
    expect(decodeCredentialRecord(encodeAccountRecord(account))).toBeNull();
  });

  it('refuses a CID that arrived as a string, as a JSON codec would give it', () => {
    expect(decodeAccountRecord(cborEncode({ ...account, cid: account.cid.toString() }))).toBeNull();
  });

  it('refuses bytes that are not CBOR at all', () => {
    expect(decodeAccountRecord(new TextEncoder().encode('{"v":1}'))).toBeNull();
  });
});
