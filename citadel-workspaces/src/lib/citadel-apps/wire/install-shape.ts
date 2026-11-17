/**
 * The shapes of what the server sends about apps, checked field by field before anything reads
 * them: an answer that is not exactly one of these is treated as a refusal, never as data.
 * u64 fields arrive as bigints (the client's codec decodes them by name).
 */
import type { AppInstall, AppListing, Capability, InstallScope, InstallState, ListingSource } from 'citadel-workspace-client-ts';
import { CAPABILITIES } from '../manifest/manifest-shape';

export type Json = Record<string, unknown>;
export const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isString = (v: unknown): v is string => typeof v === 'string';
export const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);
const isBigint = (v: unknown): v is bigint => typeof v === 'bigint';

/** No key but these, each passing its check (an absent key is checked as undefined). */
export function exactly(v: unknown, checks: Record<string, (x: unknown) => boolean>): v is Json {
  if (!isObject(v)) return false;
  return Object.keys(v).every((k: string) => k in checks) && Object.entries(checks).every(([k, check]) => check(v[k]));
}

/** A one-key object `{ name: value }` whose value passes `check`. */
export function single(v: unknown, name: string, check: (x: unknown) => boolean): boolean {
  return isObject(v) && Object.keys(v).length === 1 && name in v && check(v[name]);
}

export const isCapability = (v: unknown): v is Capability => isString(v) && (CAPABILITIES as readonly string[]).includes(v);

export function isInstallScope(v: unknown): v is InstallScope {
  return v === 'Workspace' || single(v, 'Node', isString) || single(v, 'NodeTree', isString)
    || single(v, 'Users', isStrings) || single(v, 'SelfOnly', isString);
}

function isInstallState(v: unknown): v is InstallState {
  if (v === 'Active') return true;
  return single(v, 'NeedsConsent', (x: unknown) => exactly(x, { version: isString, reason: (r: unknown) => r === 'CapabilitiesGrew' || r === 'PublisherKeyChanged' }))
    || single(v, 'Suspended', (x: unknown) => exactly(x, { reason: isString }));
}

export function isListingSource(v: unknown): v is ListingSource {
  return v === 'Upload' || v === 'FirstParty' || single(v, 'Global', (x: unknown) => exactly(x, { catalogue_version: isBigint }))
    || single(v, 'WorkspaceRegistry', (x: unknown) => exactly(x, { entry_id: isString }));
}

export const isBytes = (v: unknown): v is number[] => Array.isArray(v) && v.every((b: unknown) => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255);

export function isAppListing(v: unknown): v is AppListing {
  return exactly(v, { source: isListingSource, manifest_bytes: isBytes, signature: isString });
}

export function isAppInstall(v: unknown): v is AppInstall {
  return exactly(v, {
    id: isString, app_id: isString, version: isString, manifest_sha256: isString, artifact_sha256: isString,
    pinned_publisher_key: isString, scope: isInstallScope,
    granted: (x: unknown) => Array.isArray(x) && x.every(isCapability),
    details: (x: unknown) => exactly(x, { host_network_hosts: isStrings, server_network_hosts: isStrings, ihttp_routes: isStrings, ihttp_call_targets: isStrings, ihttp_p2p_routes: isStrings, topics: isStrings }),
    installed_by: isString, installed_at_ms: isBigint, state: isInstallState,
    // Undefined as well as null: an Option the wasm client hands over as `None` arrives undefined.
    previous: (x: unknown) => x === null || x === undefined || exactly(x, { version: isString, manifest_sha256: isString, artifact_sha256: isString }),
    injected_header_into: isStrings, source: isListingSource,
  });
}
