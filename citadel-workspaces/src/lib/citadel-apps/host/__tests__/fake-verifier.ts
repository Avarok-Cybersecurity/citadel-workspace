/**
 * TEST FAKE of ArtifactVerifierPort: real sha256 (node:crypto) and a stand-in signature, sha256
 * of key || message, because ML-DSA-65 lives in the Rust wasm client (wired by a later stream).
 */
import { createHash } from 'node:crypto';
import type { ArtifactVerifierPort } from '../verify-artifact';

export const sha256Hex = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

export const fakeSign = (keyHex: string, appId: string, version: string, mHash: string, wHash: string): Uint8Array =>
  Uint8Array.from(createHash('sha256').update(`${keyHex}|citadel-app-v1|${appId}|${version}|${mHash}|${wHash}`).digest());

export const fakeVerifier: ArtifactVerifierPort = {
  sha256Hex: async (b: Uint8Array): Promise<string> => sha256Hex(b),
  verifyAppSignature: async (i): Promise<boolean> =>
    Buffer.from(fakeSign(i.publicKeyHex, i.appId, i.version, i.manifestSha256Hex, i.wasmSha256Hex)).equals(Buffer.from(i.signature)),
};
