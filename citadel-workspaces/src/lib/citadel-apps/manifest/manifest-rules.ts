/**
 * Reading an app manifest from its exact published bytes, refused for the first malformed field:
 * `AppManifest::from_bytes` (citadel-workspace-types/src/apps_manifest_check.rs), mirrored rule
 * for rule and held to the shared cases in apps/catalogue/fixtures/manifest-cases.json. The
 * kernel validates on publish and CI on every catalogue change; the marketplace reads with the
 * same rules so that nothing it shows is a manifest the server would refuse.
 */
import type { AppAudience, AppManifest, ScopeKind } from 'citadel-workspace-client-ts';
import { isAppId, isScopeId, parseAppVersion, compareVersions, type AppVersion } from '../app-identity';
import { appIconSrc } from '../icon';
import { hasManifestShape, NODE_REACHING_SCOPES } from './manifest-shape';
import { hasDuplicateKeys } from './json-duplicate-keys';
import { isHttpsUrl } from './net-rules';
import { artifactProblem, capabilitiesProblem, distinct, limitsProblem, lowerHex, plainText } from './manifest-rules-parts';

export const MAX_MANIFEST_BYTES: number = 192 * 1024;
export const ABI_V1: string = 'citadel-app-abi-1';
export const ABI_FIRST_PARTY_GLUE: string = 'wasm-bindgen-glue-firstparty';

/** The Rust `ManifestRefusal` variant each refusal corresponds to. */
export type ManifestField =
  | 'TooLarge' | 'Json' | 'Format' | 'Id' | 'Version' | 'Sdk' | 'Publisher' | 'Name' | 'Summary' | 'Description'
  | 'Icon' | 'Categories' | 'Audience' | 'Surfaces' | 'Scopes' | 'Capabilities' | 'Limits' | 'Artifact' | 'PreviousVersions';

export type ManifestReading = { ok: true; manifest: AppManifest } | { ok: false; field: ManifestField; why: string };

const refuse = (field: ManifestField, why: string): ManifestReading => ({ ok: false, field, why });

function sdkProblem(manifest: AppManifest): string | null {
  const { abi, min, max } = manifest.sdk;
  if (abi !== ABI_V1 && abi !== ABI_FIRST_PARTY_GLUE) return 'unknown abi';
  const floor: AppVersion | null = parseAppVersion(min);
  if (floor === null) return 'min is not a version';
  const major: AppVersion | null = max.endsWith('.x') ? parseAppVersion(`${max.slice(0, -2)}.0.0`) : null;
  const ceiling: AppVersion | null = max.endsWith('.x') ? null : parseAppVersion(max);
  const ok: boolean = major !== null ? major.major >= floor.major : ceiling !== null && compareVersions(ceiling, floor) >= 0;
  return ok ? null : 'max is neither a version nor N.x at or above min';
}

function audienceProblem(audience: AppAudience): string | null {
  const namesOk = (names: string[], max: number): boolean => names.length >= 1 && names.length <= max && names.every(isScopeId) && distinct(names);
  switch (audience.kind) {
    case 'global': case 'workspace': return null;
    case 'node_viewers': case 'node_tree_viewers': return isScopeId(audience.node_id) ? null : 'node_id';
    case 'members': return namesOk(audience.usernames, 500) ? null : 'an empty, oversized, repeated or malformed list';
    case 'roles': return namesOk(audience.role_ids, 64) ? null : 'an empty, oversized, repeated or malformed list';
  }
}

/** The rules, in `validate`'s order: the first that is wrong is the answer. */
export function validateManifest(m: AppManifest): ManifestReading {
  if (m.format !== 1) return refuse('Format', 'format is not 1');
  if (!isAppId(m.id)) return refuse('Id', 'not an app id');
  const version: AppVersion | null = parseAppVersion(m.version);
  if (version === null) return refuse('Version', 'not MAJOR.MINOR.PATCH');
  const sdk: string | null = sdkProblem(m);
  if (sdk !== null) return refuse('Sdk', sdk);
  if (!plainText(m.publisher.name, 64, false)) return refuse('Publisher', 'name');
  if (!lowerHex(m.publisher.mldsa65_public_key, 3904)) return refuse('Publisher', 'mldsa65_public_key is not 3904 lowercase hex characters');
  if (!isHttpsUrl(m.publisher.contact, 256)) return refuse('Publisher', 'contact is not an https URL');
  if (!plainText(m.name, 48, false)) return refuse('Name', 'not 1 to 48 characters of plain text');
  if (!plainText(m.summary, 140, false)) return refuse('Summary', 'not 1 to 140 characters of plain text');
  if (!plainText(m.description, 4000, true)) return refuse('Description', 'not 1 to 4000 characters of plain text');
  if (appIconSrc(m.icon) === null) return refuse('Icon', 'not a PNG within max_bytes, itself within 1..=65536');
  if (m.categories.length < 1 || m.categories.length > 3 || !distinct(m.categories)) return refuse('Categories', 'one to three, distinct');
  const audience: string | null = audienceProblem(m.audience);
  if (audience !== null) return refuse('Audience', audience);
  if (!distinct(m.surfaces)) return refuse('Surfaces', 'repeated');
  if (m.scopes.length === 0 || !distinct(m.scopes)) return refuse('Scopes', 'empty or repeated');
  if (m.surfaces.includes('node_tab') && !m.scopes.some((s: ScopeKind): boolean => NODE_REACHING_SCOPES.includes(s))) return refuse('Scopes', 'a node tab needs a workspace, node or node_tree scope');
  const caps: string | null = capabilitiesProblem(m.id, m.capabilities);
  if (caps !== null) return refuse('Capabilities', caps);
  const limits: string | null = limitsProblem(m.limits, m.capabilities);
  if (limits !== null) return refuse('Limits', limits);
  const artifact: string | null = artifactProblem(m.artifact);
  if (artifact !== null) return refuse('Artifact', artifact);
  const previous: string[] | undefined = m.previous_versions;
  if (previous !== undefined) {
    const older = (v: string): boolean => { const p: AppVersion | null = parseAppVersion(v); return p !== null && compareVersions(p, version) < 0; };
    if (previous.length > 32 || !previous.every(older) || !distinct(previous)) return refuse('PreviousVersions', 'more than 32, not all older, or repeated');
  }
  return { ok: true, manifest: m };
}

/** The shape-checked JSON as the generated type: the icon cap a bigint, absent optionals absent. */
function asManifest(value: Record<string, unknown>): AppManifest {
  const copy: Record<string, unknown> = JSON.parse(JSON.stringify(value), (_k: string, v: unknown): unknown => (v === null ? undefined : v)) as Record<string, unknown>;
  const icon: { png_base64: string; max_bytes: number } = copy.icon as { png_base64: string; max_bytes: number };
  return { ...copy, icon: { png_base64: icon.png_base64, max_bytes: BigInt(icon.max_bytes) } } as AppManifest;
}

export function readManifestBytes(bytes: Uint8Array): ManifestReading {
  if (bytes.length > MAX_MANIFEST_BYTES) return refuse('TooLarge', `larger than ${MAX_MANIFEST_BYTES} bytes`);
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    return refuse('Json', 'not UTF-8 JSON');
  }
  if (!hasManifestShape(value) || hasDuplicateKeys(text)) return refuse('Json', 'an unknown, duplicate or missing field, or a wrong type');
  return validateManifest(asManifest(value as Record<string, unknown>));
}
