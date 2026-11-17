/** Where an install or update says its manifest comes from (listing-offer.ts). */
import { describe, expect, it } from 'vitest';
import type { AppInstall, AppListing, ListingOffer } from 'citadel-workspace-client-ts';
import { listingOffer, updateOffer } from '../listing-offer';
import { listedApps, type ListedApp } from '../listing-model';
import { installOf, listingOf } from '@/test/app-manifests';

describe('listingOffer', () => {
  it('names a registry listing by its entry, and sends any other as the signed bytes it is', () => {
    const registry: AppListing = listingOf({ id: 'com.acme.kanban' }, 'workspace');
    expect(listingOffer(registry)).toEqual({ Registry: { entry_id: 'entry-com.acme.kanban' } });
    const global: AppListing = listingOf({ id: 'com.acme.kanban' });
    expect(listingOffer(global)).toEqual({ Signed: { manifest_bytes: global.manifest_bytes, signature: global.signature } });
    expect(listingOffer({ ...global, source: 'Upload' })).toEqual({ Signed: { manifest_bytes: global.manifest_bytes, signature: global.signature } });
  });
});

describe('updateOffer', () => {
  const global: AppListing = listingOf({ id: 'com.acme.kanban' });
  const apps: ListedApp[] = listedApps([global, listingOf({ id: 'com.acme.lint' }, 'workspace')]);
  it('a registry install looks only at its own entry', () => {
    const install: AppInstall = installOf('com.acme.lint', 'Workspace', { source: { WorkspaceRegistry: { entry_id: 'entry-7' } } });
    expect(updateOffer(install, apps)).toEqual({ Registry: { entry_id: 'entry-7' } });
  });
  it('any other takes the global catalogue listing of the same app, or nothing when there is none', () => {
    const fromCatalogue: AppInstall = installOf('com.acme.kanban', 'Workspace');
    const uploaded: AppInstall = installOf('com.acme.kanban', 'Workspace', { source: 'Upload' });
    const expected: ListingOffer = { Signed: { manifest_bytes: global.manifest_bytes, signature: global.signature } };
    expect([updateOffer(fromCatalogue, apps), updateOffer(uploaded, apps)]).toEqual([expected, expected]);
    expect(updateOffer(installOf('com.acme.lint', 'Workspace'), apps)).toBeNull();
    expect(updateOffer(installOf('com.acme.gone', 'Workspace'), apps)).toBeNull();
  });
});
