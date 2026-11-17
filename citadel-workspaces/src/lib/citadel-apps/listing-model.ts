/**
 * The marketplace's listings: the global catalogue served with the UI (/apps/catalogue.json) and
 * what the kernel answers `ListCatalogue` with (global entries, and this workspace's registry
 * entries whose audience admits the caller; it filters, the UI never sees the rest), each read from
 * its exact manifest bytes with the kernel's rules. A listing that does not read is left out.
 */
import type { AppListing, AppManifest } from 'citadel-workspace-client-ts';
import { readManifestBytes, type ManifestReading } from './manifest/manifest-rules';
import { readCatalogue, type CatalogueReading, type ReadEntry } from './manifest/catalogue-format';
import { compareVersions, parseAppVersion, type AppVersion } from './app-identity';

export const GLOBAL_CATALOGUE_URL: string = '/apps/catalogue.json';

export type ListingOrigin = 'global' | 'workspace';

export interface ListedApp {
  listing: AppListing;
  manifest: AppManifest;
  origin: ListingOrigin;
}

/** Reads a same-origin URL as text; rejects on a non-OK answer. */
export type FetchText = (url: string) => Promise<string>;

export type GlobalCatalogue = { ok: true; listings: AppListing[] } | { ok: false; why: string };

export async function loadGlobalCatalogue(fetchText: FetchText): Promise<GlobalCatalogue> {
  let text: string;
  try {
    text = await fetchText(GLOBAL_CATALOGUE_URL);
  } catch (error: unknown) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  const reading: CatalogueReading = readCatalogue(text);
  if (!reading.ok) return { ok: false, why: reading.why };
  const catalogueVersion: bigint = reading.catalogueVersion;
  return {
    ok: true,
    listings: reading.entries.map((e: ReadEntry): AppListing => ({
      source: { Global: { catalogue_version: catalogueVersion } },
      manifest_bytes: Array.from(e.manifestBytes),
      signature: e.entry.signature,
    })),
  };
}

const originOf = (listing: AppListing): ListingOrigin => (typeof listing.source === 'object' && 'Global' in listing.source ? 'global' : 'workspace');

const newer = (a: AppManifest, b: AppManifest): boolean => {
  const va: AppVersion | null = parseAppVersion(a.version);
  const vb: AppVersion | null = parseAppVersion(b.version);
  return va !== null && vb !== null && compareVersions(va, vb) > 0;
};

/** Every listing that reads, one per origin and app (the highest version), sorted by name. */
export function listedApps(listings: readonly AppListing[]): ListedApp[] {
  const byKey: Map<string, ListedApp> = new Map();
  for (const listing of listings) {
    const reading: ManifestReading = readManifestBytes(Uint8Array.from(listing.manifest_bytes));
    if (!reading.ok) continue;
    const app: ListedApp = { listing, manifest: reading.manifest, origin: originOf(listing) };
    const key: string = `${app.origin}\n${app.manifest.id}`;
    const held: ListedApp | undefined = byKey.get(key);
    if (held === undefined || newer(app.manifest, held.manifest)) byKey.set(key, app);
  }
  return [...byKey.values()].sort((a: ListedApp, b: ListedApp) => a.manifest.name.localeCompare(b.manifest.name));
}

/** Apps whose name, summary or a category holds every word of `query`, ignoring case. */
export function searchApps(apps: readonly ListedApp[], query: string): ListedApp[] {
  const words: string[] = query.toLowerCase().split(/\s+/).filter((w: string) => w !== '');
  if (words.length === 0) return [...apps];
  return apps.filter((app: ListedApp) => {
    const haystack: string = [app.manifest.name, app.manifest.summary, ...app.manifest.categories].join(' ').toLowerCase();
    return words.every((w: string) => haystack.includes(w));
  });
}

export function findListedApp(apps: readonly ListedApp[], appId: string): ListedApp | null {
  return apps.find((a: ListedApp) => a.manifest.id === appId && a.origin === 'workspace') ?? apps.find((a: ListedApp) => a.manifest.id === appId) ?? null;
}
