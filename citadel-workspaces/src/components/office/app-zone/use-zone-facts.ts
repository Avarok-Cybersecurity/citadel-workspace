/** What a zone needs to know about its app, read through the page's zone environment. */
import { useEffect, useState } from 'react';
import type { AppInstall } from 'citadel-workspace-client-ts';
import type { ListedApp } from '@/lib/citadel-apps/listing-model';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import { useDisabledForMe } from '@/lib/citadel-apps/disabled-for-me';
import { usePeerForMe } from '@/lib/citadel-apps/peer-for-me';
import type { AppZoneEnvironment } from './app-zone-environment';
import type { ZoneFacts } from './zone-state';

export function useZoneFacts(env: AppZoneEnvironment, appId: string): ZoneFacts {
  const [listing, setListing] = useState<ZoneFacts['listing']>('loading');
  const [installs, setInstalls] = useState<ZoneFacts['installs']>('loading');
  const disabledForMe: ReadonlySet<string> = useDisabledForMe();
  const peerForMe: ReturnType<typeof usePeerForMe> = usePeerForMe();

  useEffect(() => {
    let live: boolean = true;
    void env.data.listing(appId).then((r: AppsResult<ListedApp>) => { if (live) setListing(r.ok ? r.value : 'unavailable'); });
    void env.data.installs().then((r: AppsResult<AppInstall[]>) => { if (live) setInstalls(r.ok ? r.value : 'unavailable'); });
    return (): void => { live = false; };
  }, [env.data, appId]);

  return { listing, installs, me: env.me, nodeId: env.nodeId, ancestors: env.ancestors, disabledForMe, peerForMe, mayInstall: env.mayInstall };
}
