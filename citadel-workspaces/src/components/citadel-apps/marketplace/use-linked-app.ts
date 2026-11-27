/**
 * The app a link (or a zone) opened the marketplace on: found in what is listed, or asked for on
 * its own (`GetListing`), or -- for a missing app and one outside your audience alike -- not
 * available. No answer, or one that does not read, is `unreachable` instead: that is asked again
 * (`retry`), where a refusal is an admin's to change. Answered once per opening, and per retry.
 */
import { useEffect, useState } from 'react';
import type { AppListing } from 'citadel-workspace-client-ts';
import { findListedApp, listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import { getListing, type AppsFailure, type AppsResult } from '@/lib/workspace-service/apps-operations';
import type { MarketplaceData } from './use-marketplace-data';
import type { MarketplaceDeps } from './marketplace-types';

export type LinkedApp =
  | { kind: 'none' }
  | { kind: 'looking' }
  | { kind: 'found'; app: ListedApp }
  /** `retry` asks again in place: it rejects when the answer still did not get through. */
  | { kind: 'unreachable'; failure: Unreached; retry: () => Promise<void> }
  | { kind: 'unavailable' };

/** The failures that say nothing about the app: the request or its answer did not get through. */
export type Unreached = Extract<AppsFailure, 'NoAnswer' | 'Malformed'>;
const unreached = (f: AppsFailure): f is Unreached => f === 'NoAnswer' || f === 'Malformed';

type Asked = { kind: 'no' } | { kind: 'asking' } | { kind: 'unreachable'; failure: Unreached } | { kind: 'unavailable' };

/** Asks for `appId`'s listing: a listing that reads is added; otherwise what was heard is recorded and returned. */
async function askListing(deps: MarketplaceDeps, appId: string, addListing: (l: AppListing) => void, record: (a: Asked) => void): Promise<Asked> {
  const r: AppsResult<AppListing> = await getListing(deps.transport, appId);
  // A listing that does not read is as unavailable as one refused.
  if (r.ok && listedApps([r.value]).length > 0) {
    addListing(r.value);
    return { kind: 'asking' };
  }
  const heard: Asked = !r.ok && unreached(r.refusal) ? { kind: 'unreachable', failure: r.refusal } : { kind: 'unavailable' };
  record(heard);
  return heard;
}

export function useLinkedApp(appId: string | null, data: MarketplaceData, deps: MarketplaceDeps): LinkedApp {
  const [asked, setAsked] = useState<Asked>({ kind: 'no' });
  const listed: ListedApp | null = appId === null ? null : findListedApp(data.apps, appId);
  const { loading, addListing } = data;

  useEffect(() => {
    if (appId === null || loading || listed !== null || asked.kind !== 'no') return;
    setAsked({ kind: 'asking' });
    void askListing(deps, appId, addListing, setAsked);
  }, [appId, loading, listed, asked, deps, addListing]);

  if (appId === null) return { kind: 'none' };
  if (listed !== null) return { kind: 'found', app: listed };
  if (asked.kind === 'unavailable') return { kind: 'unavailable' };
  if (asked.kind === 'unreachable') {
    const id: string = appId;
    const retry = async (): Promise<void> => {
      const heard: Asked = await askListing(deps, id, addListing, setAsked);
      if (heard.kind === 'unreachable') throw new Error('The workspace server did not answer this time either.');
    };
    return { kind: 'unreachable', failure: asked.failure, retry };
  }
  return { kind: 'looking' };
}
