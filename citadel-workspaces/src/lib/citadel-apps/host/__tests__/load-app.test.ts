/**
 * The load pipeline's gates in order: integrity before compiling, the ABI verdict before
 * instantiating, and the memory the instance is given.
 */
import { describe, expect, it } from 'vitest';
import type { Capability } from '../capabilities';
import { STANDARD_HOST_POLICY } from '../limits';
import { prepareApp, type LoadRequest, type PreparedApp } from '../load-app';
import { appModule } from './app-fixtures';
import { fakeSign, fakeVerifier, sha256Hex } from './fake-verifier';

const KEY: string = 'cc'.repeat(32);
const manifestBytes: Uint8Array = new TextEncoder().encode('{"id":"com.acme.net"}');

function request(wasm: Uint8Array, declared: readonly Capability[], manifestMemoryPages: number = 1024): LoadRequest {
  const w: string = sha256Hex(wasm);
  return {
    install: { appId: 'com.acme.net', version: '1.0.0', manifestSha256Hex: sha256Hex(manifestBytes), artifactSha256Hex: w, pinnedPublisherKeyHex: KEY },
    bundle: {
      manifestBytes, wasm, signature: fakeSign(KEY, 'com.acme.net', '1.0.0', sha256Hex(manifestBytes), w),
      manifest: { id: 'com.acme.net', version: '1.0.0', publisherKeyHex: KEY, artifactSha256Hex: w, artifactBytes: wasm.byteLength },
    },
    declared: new Set<Capability>(declared), manifestMemoryPages, policy: STANDARD_HOST_POLICY,
  };
}

describe('prepareApp', () => {
  it('a module importing net without a network capability is refused by the ABI gate (control: declared, it loads)', async () => {
    const wasm: Uint8Array = appModule({ groups: ['net'], memory: { min: 1, max: 32 } });
    const refused: PreparedApp = await prepareApp(request(wasm, []), fakeVerifier);
    expect(refused).toMatchObject({ ok: false, gate: 'abi', reasons: ['undeclared_group:net'] });
    const loaded: PreparedApp = await prepareApp(request(wasm, ['net.server'], 16), fakeVerifier);
    expect(loaded.ok && loaded.memory).toEqual({ initialPages: 1, maxPages: 16 });
  });

  it('a module declaring a smaller maximum than the manifest gets the module maximum', async () => {
    const loaded: PreparedApp = await prepareApp(request(appModule({ memory: { min: 2, max: 8 } }), []), fakeVerifier);
    expect(loaded.ok && loaded.memory).toEqual({ initialPages: 2, maxPages: 8 });
  });

  it('integrity is checked before the ABI: tampered bytes never reach the compiler', async () => {
    const r: LoadRequest = request(appModule(), []);
    const tampered: Uint8Array = Uint8Array.from([...r.bundle.wasm.slice(0, -1), 0x00, 0x00]);
    const refused: PreparedApp = await prepareApp({ ...r, bundle: { ...r.bundle, wasm: tampered, manifest: { ...r.bundle.manifest, artifactBytes: tampered.byteLength } } }, fakeVerifier);
    expect(refused).toEqual({ ok: false, gate: 'artifact', refusal: 'hash_mismatch' });
  });
});
