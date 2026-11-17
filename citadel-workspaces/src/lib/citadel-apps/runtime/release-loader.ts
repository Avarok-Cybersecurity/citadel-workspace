/**
 * From an install record to a module an instance may run: the server's signed release
 * (`GetRelease`), its artifact by the digest the install PINNED (`FetchArtifact`, never the
 * manifest's own claim), then integrity and the ABI verdict (host/load-app.ts). Nothing is
 * compiled before integrity passes. Each refusal says which step refused, so the zone can say so.
 */
import type { AppInstall, AppManifest } from 'citadel-workspace-client-ts';
import type { AppsFailure, AppsResult, AppsTransport } from '@/lib/workspace-service/apps-operations';
import { fetchArtifact, getRelease, type Release } from '@/lib/workspace-service/apps-runtime-operations';
import { readManifestBytes, type ManifestReading } from '../manifest/manifest-rules';
import type { Capability } from '../host/capabilities';
import type { HostPolicy } from '../host/limits';
import { prepareApp, type PreparedApp } from '../host/load-app';
import { MAX_ARTIFACT_BYTES, type ArtifactBundle, type ArtifactRefusal, type ArtifactVerifierPort, type PinnedInstall } from '../host/verify-artifact';

export type ReleaseFailure =
  | { readonly step: 'release' | 'artifact'; readonly refusal: AppsFailure }
  | { readonly step: 'manifest'; readonly why: string }
  | { readonly step: 'signature-text' }
  | { readonly step: 'integrity'; readonly refusal: ArtifactRefusal }
  | { readonly step: 'abi'; readonly reasons: readonly string[] };

export type LoadedRelease =
  | { readonly ok: true; readonly manifest: AppManifest; readonly module: WebAssembly.Module; readonly memory: { readonly initialPages: number; readonly maxPages: number } }
  | { readonly ok: false; readonly failure: ReleaseFailure };

const HEX: RegExp = /^(?:[0-9a-f]{2})+$/;

/** The `app.mldsa.sig` text (lowercase hex, one line) as bytes; null for anything else. */
export function signatureBytes(text: string): Uint8Array | null {
  const t: string = text.trim();
  if (!HEX.test(t)) return null;
  const out: Uint8Array = new Uint8Array(t.length / 2);
  for (let i: number = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function pinnedOf(install: AppInstall): PinnedInstall {
  return {
    appId: install.app_id, version: install.version, manifestSha256Hex: install.manifest_sha256,
    artifactSha256Hex: install.artifact_sha256, pinnedPublisherKeyHex: install.pinned_publisher_key,
  };
}

const failed = (failure: ReleaseFailure): LoadedRelease => ({ ok: false, failure });

export async function loadRelease(t: AppsTransport, install: AppInstall, verifier: ArtifactVerifierPort, policy: HostPolicy): Promise<LoadedRelease> {
  const release: AppsResult<Release> = await getRelease(t, install.id);
  if (!release.ok) return failed({ step: 'release', refusal: release.refusal });
  const manifestBytes: Uint8Array = Uint8Array.from(release.value.current.manifest_bytes);
  const reading: ManifestReading = readManifestBytes(manifestBytes);
  if (!reading.ok) return failed({ step: 'manifest', why: `${reading.field}: ${reading.why}` });
  const manifest: AppManifest = reading.manifest;
  const signature: Uint8Array | null = signatureBytes(release.value.current.signature);
  if (signature === null) return failed({ step: 'signature-text' });
  const wasm: AppsResult<Uint8Array> = await fetchArtifact(t, install.artifact_sha256, MAX_ARTIFACT_BYTES);
  if (!wasm.ok) return failed({ step: 'artifact', refusal: wasm.refusal });
  const bundle: ArtifactBundle = {
    manifestBytes, wasm: wasm.value, signature,
    manifest: {
      id: manifest.id, version: manifest.version, publisherKeyHex: manifest.publisher.mldsa65_public_key,
      artifactSha256Hex: manifest.artifact.sha256, artifactBytes: manifest.artifact.bytes,
    },
  };
  const declared: ReadonlySet<Capability> = new Set<Capability>(manifest.capabilities.map((c: { cap: Capability }) => c.cap));
  const prepared: PreparedApp = await prepareApp({ install: pinnedOf(install), bundle, declared, manifestMemoryPages: manifest.limits.memory_pages, policy }, verifier);
  if (!prepared.ok) return failed(prepared.gate === 'artifact' ? { step: 'integrity', refusal: prepared.refusal } : { step: 'abi', reasons: prepared.reasons });
  return { ok: true, manifest, module: prepared.module, memory: prepared.memory };
}
