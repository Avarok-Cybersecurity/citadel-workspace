/**
 * Where the manifest an install or update takes comes from (`AppsRequest::Install.listing`,
 * `Update.listing`): this workspace's registry entry by id, or the signed listing bytes the
 * client already verified, which the server verifies again. Pure.
 */
import type { AppInstall, AppListing, ListingOffer } from 'citadel-workspace-client-ts';
import type { ListedApp } from './listing-model';

/** The offer for installing `listing` as the marketplace shows it. */
export function listingOffer(listing: AppListing): ListingOffer {
  if (typeof listing.source === 'object' && 'WorkspaceRegistry' in listing.source) {
    return { Registry: { entry_id: listing.source.WorkspaceRegistry.entry_id } };
  }
  return { Signed: { manifest_bytes: listing.manifest_bytes, signature: listing.signature } };
}

/**
 * Where `install` looks for a newer version. One from the registry takes only its own entry; any
 * other (the server records a signed listing as an upload) takes a signed manifest, here the
 * global catalogue's listing of the same app. Null when the catalogue does not list it: there is
 * nothing to offer.
 */
export function updateOffer(install: AppInstall, apps: readonly ListedApp[]): ListingOffer | null {
  const source: AppInstall['source'] = install.source;
  if (typeof source === 'object' && 'WorkspaceRegistry' in source) return { Registry: { entry_id: source.WorkspaceRegistry.entry_id } };
  const listed: ListedApp | undefined = apps.find((a: ListedApp) => a.origin === 'global' && a.manifest.id === install.app_id);
  return listed === undefined ? null : listingOffer(listed.listing);
}
