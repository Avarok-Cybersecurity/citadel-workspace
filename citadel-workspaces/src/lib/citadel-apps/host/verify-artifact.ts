/**
 * Integrity before anything is compiled (design 2.1): whichever location served the bytes, they
 * load only if their sha256 equals the manifest's and the install record's, the manifest's own
 * hash equals the install record's, the manifest still names the key the installer pinned, and the
 * detached signature verifies under that pinned key.
 *
 * Pure over ArtifactVerifierPort: hashing and ML-DSA-65 verification are done by the Rust wasm
 * client (`citadel-app-signature`), which also builds the signed message
 * (`citadel-app-v1\0 || id || \0 || version || \0 || sha256(manifest) || sha256(wasm)`), so the
 * signature scheme is Rust everywhere and never JS. This file decides; the port computes.
 */

export interface ArtifactVerifierPort {
  /** Lower-case hex sha256. */
  readonly sha256Hex: (bytes: Uint8Array) => Promise<string>;
  /** True only when `signature` is a valid ML-DSA-65 signature by `publicKeyHex` over the app-v1 message. */
  readonly verifyAppSignature: (input: {
    readonly publicKeyHex: string;
    readonly appId: string;
    readonly version: string;
    readonly manifestSha256Hex: string;
    readonly wasmSha256Hex: string;
    readonly signature: Uint8Array;
  }) => Promise<boolean>;
}

/** What the install record pinned when someone with authority consented. */
export interface PinnedInstall {
  readonly appId: string;
  readonly version: string;
  readonly manifestSha256Hex: string;
  readonly artifactSha256Hex: string;
  readonly pinnedPublisherKeyHex: string;
}

/** The manifest fields this check reads (the manifest parser is the app-types stream's). */
export interface ManifestFacts {
  readonly id: string;
  readonly version: string;
  readonly publisherKeyHex: string;
  readonly artifactSha256Hex: string;
  readonly artifactBytes: number;
}

export interface ArtifactBundle {
  readonly manifestBytes: Uint8Array;
  readonly manifest: ManifestFacts;
  readonly wasm: Uint8Array;
  readonly signature: Uint8Array;
}

export type ArtifactRefusal =
  | 'too_large' | 'size_mismatch' | 'wrong_app' | 'manifest_changed' | 'hash_mismatch'
  | 'publisher_key_changed' | 'bad_signature' | 'verifier_failed';

export type ArtifactVerdict = { readonly ok: true } | { readonly ok: false; readonly refusal: ArtifactRefusal };

/** Design 2.1: the artifact cap, enforced before hashing. */
export const MAX_ARTIFACT_BYTES: number = 8 * 1024 * 1024;

const refuse = (refusal: ArtifactRefusal): ArtifactVerdict => ({ ok: false, refusal });

export async function verifyArtifact(install: PinnedInstall, bundle: ArtifactBundle, port: ArtifactVerifierPort): Promise<ArtifactVerdict> {
  const { manifest, wasm } = bundle;
  if (wasm.byteLength > MAX_ARTIFACT_BYTES) return refuse('too_large');
  if (wasm.byteLength !== manifest.artifactBytes) return refuse('size_mismatch');
  if (manifest.id !== install.appId || manifest.version !== install.version) return refuse('wrong_app');
  // A different key in the manifest is a key change, whatever it signed: it needs re-consent, not a load.
  if (manifest.publisherKeyHex.toLowerCase() !== install.pinnedPublisherKeyHex.toLowerCase()) return refuse('publisher_key_changed');
  let manifestHash: string;
  let wasmHash: string;
  try {
    [manifestHash, wasmHash] = await Promise.all([port.sha256Hex(bundle.manifestBytes), port.sha256Hex(wasm)]);
  } catch {
    return refuse('verifier_failed');
  }
  if (manifestHash !== install.manifestSha256Hex.toLowerCase()) return refuse('manifest_changed');
  if (wasmHash !== manifest.artifactSha256Hex.toLowerCase() || wasmHash !== install.artifactSha256Hex.toLowerCase()) return refuse('hash_mismatch');
  let valid: boolean;
  try {
    valid = await port.verifyAppSignature({
      publicKeyHex: install.pinnedPublisherKeyHex, appId: install.appId, version: install.version,
      manifestSha256Hex: manifestHash, wasmSha256Hex: wasmHash, signature: bundle.signature,
    });
  } catch {
    return refuse('verifier_failed');
  }
  return valid === true ? { ok: true } : refuse('bad_signature');
}
