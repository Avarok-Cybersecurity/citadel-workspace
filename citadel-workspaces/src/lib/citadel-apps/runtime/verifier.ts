/**
 * The page's ArtifactVerifierPort. SHA-256 is the platform's (WebCrypto; a digest, not the
 * signature scheme). ML-DSA-65 is Rust only: `verify_app_signature`, the wasm client's export of
 * citadel-app-signature's `verify`, so the signature is never checked in JavaScript. The module is
 * loaded on the first check, not before, and a load that fails refuses that check (the zone says
 * the app could not be checked here) and is retried on the next, never skipped.
 *
 * The key checked against is the one the install pinned (verify-artifact.ts passes it), so the
 * receiving member's pinned publisher key stays the trust anchor.
 */
import type { WasmModule } from 'citadel-workspace-client-ts';
import type { ArtifactVerifierPort } from '../host/verify-artifact';

export type AppSignatureCheck = ArtifactVerifierPort['verifyAppSignature'];
export type AppSignatureModule = Pick<WasmModule, 'verify_app_signature'>;

export function wasmAppSignatureCheck(load: () => Promise<AppSignatureModule>): AppSignatureCheck {
  let loaded: Promise<AppSignatureModule> | null = null;
  return async (input): Promise<boolean> => {
    loaded ??= load().catch((why: unknown): never => {
      loaded = null;
      throw why;
    });
    const module: AppSignatureModule = await loaded;
    return module.verify_app_signature(
      input.publicKeyHex, input.appId, input.version, input.manifestSha256Hex, input.wasmSha256Hex, input.signature,
    );
  };
}

export function pageArtifactVerifier(subtle: SubtleCrypto, verifyAppSignature: AppSignatureCheck): ArtifactVerifierPort {
  return {
    sha256Hex: async (bytes: Uint8Array): Promise<string> => {
      // A copy: WebCrypto takes an ArrayBuffer-backed view, never a shared one.
      const digest: ArrayBuffer = await subtle.digest('SHA-256', new Uint8Array(bytes));
      return Array.from(new Uint8Array(digest), (b: number) => b.toString(16).padStart(2, '0')).join('');
    },
    verifyAppSignature,
  };
}
