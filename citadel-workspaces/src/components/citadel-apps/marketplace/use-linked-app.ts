/**
 * The app a link (or a zone) opened the marketplace on: found in what is listed, or asked for on
 * its own (`GetListing`), or -- for a missing app and one outside your audience alike -- not
 * available. Answered once per opening.
 */
import { useEffect, useState } from 'react';
import type { AppListing } from 'citadel-workspace-client-ts';
import { findListedApp, listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import { getListing, type AppsResult } from '@/lib/workspace-service/apps-operations';
import type { MarketplaceData } from './use-marketplace-data';
import type { MarketplaceDeps } from './marketplace-types';

export type LinkedApp = { kind: 'none' } | { kind: 'looking' } | { kind: 'found'; app: ListedApp } | { kind: 'unavailable' };

export function useLinkedApp(appId: string | null, data: MarketplaceData, deps: MarketplaceDeps): LinkedApp {
  const [asked, setAsked] = useState<'no' | 'asking' | 'unavailable'>('no');
  const listed: ListedApp | null = appId === null ? null : findListedApp(data.apps, appId);
  const { loading, addListing } = data;

  useEffect(() => {
    if (appId === null || loading || listed !== null || asked !== 'no') return;
    setAsked('asking');
    void getListing(deps.transport, appId).then((r: AppsResult<AppListing>) => {
      // A listing that does not read is as unavailable as one refused.
      if (r.ok && listedApps([r.value]).length > 0) addListing(r.value); else setAsked('unavailable');
    });
  }, [appId, loading, listed, asked, deps, addListing]);

  if (appId === null) return { kind: 'none' };
  if (listed !== null) return { kind: 'found', app: listed };
  if (asked === 'unavailable') return { kind: 'unavailable' };
  return { kind: 'looking' };
}
