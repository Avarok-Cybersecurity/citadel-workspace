// @vitest-environment node
/**
 * The page's verifier with the REAL check: the wasm client's `verify_app_signature` (Rust,
 * citadel-app-signature) over the signed-app fixture that crate generates. A valid signature is
 * accepted; a tampered artifact, a tampered manifest, another publisher's key, a truncated
 * signature and a signature under another domain are each refused, at the port and, where the
 * pinned hashes do not refuse first, through verifyArtifact.
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { verifyArtifact, type ArtifactBundle, type ArtifactVerifierPort, type PinnedInstall } from '../../host/verify-artifact';
import { pageArtifactVerifier, wasmAppSignatureCheck } from '../verifier';
import { realSignatureModule, signedApp, type SignedApp } from './real-signature-module';

const app: SignedApp = signedApp();
const bytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, 'hex'));
const manifestBytes: Uint8Array = new TextEncoder().encode(app.manifest);
const wasm: Uint8Array = bytes(app.wasm_hex);
let port: ArtifactVerifierPort;

beforeAll(async () => {
  port = pageArtifactVerifier(webcrypto.subtle as SubtleCrypto, wasmAppSignatureCheck(realSignatureModule));
});

async function check(over: { key?: string; manifest?: Uint8Array; wasm?: Uint8Array; signature?: Uint8Array } = {}): Promise<boolean> {
  return port.verifyAppSignature({
    publicKeyHex: over.key ?? app.public_key_hex, appId: app.app_id, version: app.version,
    manifestSha256Hex: await port.sha256Hex(over.manifest ?? manifestBytes),
    wasmSha256Hex: await port.sha256Hex(over.wasm ?? wasm),
    signature: over.signature ?? bytes(app.signature_hex),
  });
}

describe('the ML-DSA-65 check the page runs', () => {
  it('accepts the publisher’s signature (the control every refusal below is one fault from)', async () => {
    expect(await check()).toBe(true);
  });

  it('refuses a tampered artifact', async () => {
    const tampered: Uint8Array = wasm.slice();
    tampered[tampered.length - 1] ^= 0x01;
    expect(await check({ wasm: tampered })).toBe(false);
  });

  it('refuses a tampered manifest', async () => {
    expect(await check({ manifest: new TextEncoder().encode(app.manifest.replace('1.4.0', '1.4.1')) })).toBe(false);
  });

  it('refuses another publisher’s key', async () => {
    expect(await check({ key: app.other_public_key_hex })).toBe(false);
  });

  it('refuses a truncated signature', async () => {
    expect(await check({ signature: bytes(app.signature_hex).slice(0, -1) })).toBe(false);
  });

  it('refuses a signature by the right key under another domain', async () => {
    expect(await check({ signature: bytes(app.wrong_domain_signature_hex) })).toBe(false);
  });
});

describe('verifyArtifact over the real check, the pinned key as the anchor', () => {
  const bundle = (key: string, signature: string): ArtifactBundle => ({
    manifestBytes, wasm, signature: bytes(signature),
    manifest: { id: app.app_id, version: app.version, publisherKeyHex: key, artifactSha256Hex: '', artifactBytes: wasm.byteLength },
  });
  const pinned = async (key: string): Promise<PinnedInstall> => ({
    appId: app.app_id, version: app.version, manifestSha256Hex: await port.sha256Hex(manifestBytes),
    artifactSha256Hex: await port.sha256Hex(wasm), pinnedPublisherKeyHex: key,
  });
  const withHash = async (b: ArtifactBundle): Promise<ArtifactBundle> => ({ ...b, manifest: { ...b.manifest, artifactSha256Hex: await port.sha256Hex(wasm) } });

  it('loads the signed release under the key the install pinned', async () => {
    const b: ArtifactBundle = await withHash(bundle(app.public_key_hex, app.signature_hex));
    expect(await verifyArtifact(await pinned(app.public_key_hex), b, port)).toEqual({ ok: true });
  });

  it('refuses it when the install pinned another key, even one the manifest also names', async () => {
    const b: ArtifactBundle = await withHash(bundle(app.other_public_key_hex, app.signature_hex));
    expect(await verifyArtifact(await pinned(app.other_public_key_hex), b, port)).toEqual({ ok: false, refusal: 'bad_signature' });
  });

  it('refuses a signature under another domain', async () => {
    const b: ArtifactBundle = await withHash(bundle(app.public_key_hex, app.wrong_domain_signature_hex));
    expect(await verifyArtifact(await pinned(app.public_key_hex), b, port)).toEqual({ ok: false, refusal: 'bad_signature' });
  });
});
