/**
 * Artifact integrity over the fake verifier port (fake-verifier.ts: why it is a fake). What is
 * under test is this module's decisions, each one fault away from the valid bundle.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ARTIFACT_BYTES, verifyArtifact, type ArtifactBundle, type ArtifactVerdict, type ArtifactVerifierPort, type PinnedInstall } from '../verify-artifact';
import { appModule } from './app-fixtures';
import { fakeSign as sign, fakeVerifier as port, sha256Hex as hex } from './fake-verifier';

const PINNED: string = 'aa'.repeat(32);
const OTHER: string = 'bb'.repeat(32);
const wasm: Uint8Array = appModule();
const manifestBytes: Uint8Array = new TextEncoder().encode('{"format":1,"id":"com.acme.kanban"}');

function bundle(over: { key?: string; signer?: string; wasm?: Uint8Array; manifestBytes?: Uint8Array; bytes?: number } = {}): ArtifactBundle {
  const w: Uint8Array = over.wasm ?? wasm;
  const m: Uint8Array = over.manifestBytes ?? manifestBytes;
  return {
    manifestBytes: m, wasm: w,
    manifest: { id: 'com.acme.kanban', version: '1.4.0', publisherKeyHex: over.key ?? PINNED, artifactSha256Hex: hex(wasm), artifactBytes: over.bytes ?? w.byteLength },
    signature: sign(over.signer ?? PINNED, 'com.acme.kanban', '1.4.0', hex(manifestBytes), hex(wasm)),
  };
}

const install: PinnedInstall = {
  appId: 'com.acme.kanban', version: '1.4.0', manifestSha256Hex: hex(manifestBytes), artifactSha256Hex: hex(wasm), pinnedPublisherKeyHex: PINNED,
};

const verdict = (b: ArtifactBundle, i: PinnedInstall = install): Promise<ArtifactVerdict> => verifyArtifact(i, b, port);

describe('verifyArtifact', () => {
  it('control: the untouched bundle under the pinned key loads', async () => {
    expect(await verdict(bundle())).toEqual({ ok: true });
  });

  it('a tampered wasm is a hash mismatch (control above: the original hashes)', async () => {
    const tampered: Uint8Array = wasm.slice();
    tampered[tampered.length - 1] ^= 0x01;
    expect(await verdict(bundle({ wasm: tampered }))).toEqual({ ok: false, refusal: 'hash_mismatch' });
  });

  it('signed by a key other than the pinned one, while claiming the pinned one: bad signature', async () => {
    expect(await verdict(bundle({ signer: OTHER }))).toEqual({ ok: false, refusal: 'bad_signature' });
  });

  it('a manifest naming a new key is a key change even when the new key signed it', async () => {
    expect(await verdict(bundle({ key: OTHER, signer: OTHER }))).toEqual({ ok: false, refusal: 'publisher_key_changed' });
    // Control: pin the new key (what re-consent records) and the same bundle loads.
    expect(await verdict(bundle({ key: OTHER, signer: OTHER }), { ...install, pinnedPublisherKeyHex: OTHER })).toEqual({ ok: true });
  });

  it('a manifest other than the consented one is refused', async () => {
    expect(await verdict(bundle({ manifestBytes: new TextEncoder().encode('{"format":1,"id":"com.acme.kanban","x":1}') }))).toEqual({ ok: false, refusal: 'manifest_changed' });
  });

  it('size: a declared size that differs, and anything over 8 MiB, are refused before hashing', async () => {
    expect(await verdict(bundle({ bytes: wasm.byteLength + 1 }))).toEqual({ ok: false, refusal: 'size_mismatch' });
    const huge: Uint8Array = new Uint8Array(MAX_ARTIFACT_BYTES + 1);
    expect(await verdict(bundle({ wasm: huge, bytes: huge.byteLength }))).toEqual({ ok: false, refusal: 'too_large' });
  });

  it('a verifier that throws refuses rather than loads', async () => {
    const broken: ArtifactVerifierPort = { ...port, verifyAppSignature: async () => { throw new Error('wasm client not ready'); } };
    expect(await verifyArtifact(install, bundle(), broken)).toEqual({ ok: false, refusal: 'verifier_failed' });
  });
});
