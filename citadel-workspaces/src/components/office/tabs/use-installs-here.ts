/**
 * The installs that decide which app tabs a node shows (lib/node-tabs/installed-tabs.ts), read
 * through the page's zone environment: the same request its zones and app tabs make, made once per
 * page, and made again whenever an install changes anywhere (AppZonePage.tsx, on `workspace:apps`:
 * this tab's own answer, another tab of this account, or the server's notice to other members).
 *
 * The last answer is kept while the next one is on its way, so a re-read never shows a tab that
 * was already gone; until the first, and after one that failed, nothing is known.
 */
import { useEffect, useState } from 'react';
import type { AppInstall } from 'citadel-workspace-client-ts';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import { INSTALLS_UNKNOWN, type InstallsHere } from '@/lib/node-tabs/installed-tabs';
import type { AppZoneEnvironment } from '../app-zone/app-zone-environment';

export function useInstallsHere(env: AppZoneEnvironment | null): InstallsHere {
  const [installs, setInstalls] = useState<readonly AppInstall[] | null>(null);
  const data: AppZoneEnvironment['data'] | null = env?.data ?? null;
  useEffect(() => {
    if (data === null) return undefined;
    let live: boolean = true;
    void data.installs().then((r: AppsResult<AppInstall[]>): void => { if (live) setInstalls(r.ok ? r.value : null); });
    return (): void => { live = false; };
  }, [data]);
  if (env === null || env.me === null || installs === null) return INSTALLS_UNKNOWN;
  return { kind: 'known', installs, me: env.me, nodeId: env.nodeId, ancestors: env.ancestors };
}
