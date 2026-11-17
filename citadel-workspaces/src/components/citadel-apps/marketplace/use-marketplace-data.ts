/**
 * The marketplace's data while it is open: the global catalogue served with the UI, the
 * kernel's catalogue (global entries and this workspace's registry, filtered to the caller's
 * audience) and the caller's installs. Loaded together; each failure is kept apart, so a server
 * without apps still shows the global listings, and says so.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppInstall, AppListing } from 'citadel-workspace-client-ts';
import { listCatalogue, listInstalls, type AppsFailure, type AppsResult, type InstallsView } from '@/lib/workspace-service/apps-operations';
import { adoptDisabledForMe } from '@/lib/citadel-apps/disabled-for-me';
import { adoptPeerForMe } from '@/lib/citadel-apps/peer-for-me';
import { listedApps, loadGlobalCatalogue, type ListedApp } from '@/lib/citadel-apps/listing-model';
import type { MarketplaceDeps } from './marketplace-types';

export interface MarketplaceData {
  loading: boolean;
  apps: ListedApp[];
  installs: AppInstall[];
  /** Why the global catalogue could not be read; null when it was. */
  globalProblem: string | null;
  /** Why the server's apps could not be listed; null when they were. */
  serverProblem: AppsFailure | null;
  reload: () => void;
  /** Replace or add one install as an answer reports it, without a reload. */
  recordInstall: (install: AppInstall) => void;
  forgetInstall: (installId: string) => void;
  /** Add a listing fetched on its own (a link to an app not in the lists). */
  addListing: (listing: AppListing) => void;
}

const failed = (r: AppsResult<unknown>): AppsFailure | null => (r.ok ? null : r.refusal);

export function useMarketplaceData(deps: MarketplaceDeps): MarketplaceData {
  const [generation, setGeneration] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [listings, setListings] = useState<AppListing[]>([]);
  const [installs, setInstalls] = useState<AppInstall[]>([]);
  const [globalProblem, setGlobalProblem] = useState<string | null>(null);
  const [serverProblem, setServerProblem] = useState<AppsFailure | null>(null);

  useEffect(() => {
    let live: boolean = true;
    setLoading(true);
    const run = async (): Promise<void> => {
      // The two server requests one after the other: the protocol has no request id, and a
      // refusal answers whichever request is waiting, so two at once could take each other's.
      const fromServer = async (): Promise<[AppsResult<AppListing[]>, AppsResult<InstallsView>]> => {
        const server: AppsResult<AppListing[]> = await listCatalogue(deps.transport);
        return [server, await listInstalls(deps.transport)];
      };
      const [global, [server, mine]] = await Promise.all([loadGlobalCatalogue(deps.fetchText), fromServer()]);
      if (!live) return;
      setListings([...(global.ok ? global.listings : []), ...(server.ok ? server.value : [])]);
      setInstalls(mine.ok ? mine.value.installs : []);
      if (mine.ok) {
        adoptDisabledForMe(mine.value.disabledForMe);
        adoptPeerForMe(mine.value.peerForMe);
      }
      setGlobalProblem(global.ok ? null : global.why);
      setServerProblem(failed(server) ?? failed(mine));
      setLoading(false);
    };
    void run();
    return (): void => { live = false; };
  }, [deps, generation]);

  const reload: () => void = useCallback((): void => setGeneration((g: number) => g + 1), []);
  const recordInstall: (install: AppInstall) => void = useCallback((install: AppInstall): void => {
    setInstalls((all: AppInstall[]) => [...all.filter((i: AppInstall) => i.id !== install.id), install]);
  }, []);
  const forgetInstall: (installId: string) => void = useCallback((installId: string): void => {
    setInstalls((all: AppInstall[]) => all.filter((i: AppInstall) => i.id !== installId));
  }, []);
  const addListing: (listing: AppListing) => void = useCallback((listing: AppListing): void => setListings((all: AppListing[]) => [...all, listing]), []);

  const apps: ListedApp[] = useMemo((): ListedApp[] => listedApps(listings), [listings]);
  return { loading, apps, installs, globalProblem, serverProblem, reload, recordInstall, forgetInstall, addListing };
}
