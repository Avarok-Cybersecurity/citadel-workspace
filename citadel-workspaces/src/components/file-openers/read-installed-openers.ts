/**
 * The installed apps that open files, read from the server: its installs that reach the member and
 * each one's signed listing (zone-data.ts, the same requests app zones make), as openers
 * (installed-openers.ts). Loaded on demand by FileOpenersProvider, so the page's first load does not
 * carry the apps client.
 */
import type { AppInstall } from 'citadel-workspace-client-ts';
import { sessionAppsTransport } from '@/lib/citadel-apps/apps-api';
import type { ListedApp } from '@/lib/citadel-apps/listing-model';
import { installedOpeners, type InstalledApp } from '@/lib/citadel-apps/openers/installed-openers';
import type { FileOpener } from '@/lib/citadel-apps/openers/openers';
import type { AppsResult } from '@/lib/workspace-service/apps-operations';
import type { ZoneDataPort } from '@/components/office/app-zone/app-zone-environment';
import { changesInstalls, zoneDataFrom } from '@/components/office/app-zone/zone-data';

export { changesInstalls };

async function installedApps(data: ZoneDataPort): Promise<InstalledApp[]> {
  const installs: AppsResult<AppInstall[]> = await data.installs();
  if (!installs.ok) throw new Error(`the installs could not be read (${installs.refusal})`);
  const found: (InstalledApp | null)[] = await Promise.all(installs.value.map(async (install: AppInstall): Promise<InstalledApp | null> => {
    const listed: AppsResult<ListedApp> = await data.listing(install.app_id);
    return listed.ok ? { install, app: listed.value } : null;
  }));
  return found.filter((a: InstalledApp | null): a is InstalledApp => a !== null);
}

export async function readInstalledOpeners(): Promise<FileOpener[]> {
  return installedOpeners(await installedApps(zoneDataFrom(sessionAppsTransport)));
}
