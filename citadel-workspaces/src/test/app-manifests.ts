/**
 * Manifests and listings for marketplace tests, built from the shared base manifest
 * (apps/catalogue/fixtures/manifest-cases.json: the Rust tests' valid manifest) with named changes,
 * so every test listing is one the kernel's rules accept.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppInstall, AppListing, AppManifest, Capability, CapabilityRequest, InstallScope } from 'citadel-workspace-client-ts';

const CASES: string = resolve(__dirname, '../../../apps/catalogue/fixtures/manifest-cases.json');
const BASE: Record<string, unknown> = (JSON.parse(readFileSync(CASES, 'utf8')) as { base: Record<string, unknown> }).base;

export const PUBLISHER_KEY: string = 'ab'.repeat(1952);
export const OTHER_KEY: string = 'cd'.repeat(1952);

/** Fields of the base manifest a test replaces, as the manifest types them; `key` is the publisher's. */
const OVERRIDABLE = ['id', 'version', 'name', 'summary', 'description', 'categories', 'audience', 'scopes', 'surfaces', 'capabilities', 'icon', 'limits'] as const satisfies readonly (keyof AppManifest)[];
export type ManifestChanges = Partial<Pick<AppManifest, (typeof OVERRIDABLE)[number]>> & { key?: string };

export function manifestJson(c: ManifestChanges = {}): Record<string, unknown> {
  const m: Record<string, unknown> = structuredClone(BASE);
  const publisher: Record<string, unknown> = m.publisher as Record<string, unknown>;
  if (c.key !== undefined) publisher.mldsa65_public_key = c.key;
  for (const k of OVERRIDABLE) {
    if (c[k] !== undefined) m[k] = c[k];
  }
  if (c.version !== undefined) delete m.previous_versions;
  return m;
}

export function listingOf(c: ManifestChanges = {}, origin: 'global' | 'workspace' = 'global'): AppListing {
  return {
    source: origin === 'global' ? { Global: { catalogue_version: 1n } } : { WorkspaceRegistry: { entry_id: `entry-${c.id ?? 'com.acme.kanban'}` } },
    manifest_bytes: Array.from(new TextEncoder().encode(JSON.stringify(manifestJson(c)))),
    signature: '0'.repeat(6618),
  };
}

export const cap = (name: Capability, optional: boolean = false, hosts?: string[]): CapabilityRequest =>
  hosts === undefined ? { cap: name, why: `Needs ${name}`, optional } : { cap: name, why: `Needs ${name}`, optional, hosts };

export function installOf(appId: string, scope: InstallScope, extra: Partial<AppInstall> = {}): AppInstall {
  return {
    id: `install-${appId}`, app_id: appId, version: '1.4.0', manifest_sha256: '1'.repeat(64), artifact_sha256: '0'.repeat(64),
    pinned_publisher_key: PUBLISHER_KEY, scope, granted: ['canvas'],
    details: { host_network_hosts: [], server_network_hosts: [], ihttp_routes: [], ihttp_call_targets: [], ihttp_p2p_routes: [], topics: [] },
    installed_by: 'alice', installed_at_ms: 1n, state: 'Active', previous: null, injected_header_into: [],
    source: { Global: { catalogue_version: 1n } }, ...extra,
  };
}
