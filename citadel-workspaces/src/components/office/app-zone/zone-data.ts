/**
 * A page's zones' apps data over the apps transport: the installs once, each app's listing once.
 * The transport is serial (serialAppsTransport), so two zones' requests never swap answers.
 *
 * An app's listing is its workspace-registry entry (`GetListing`) or, when it has none, the
 * release of an install that reaches this person (`GetRelease`): an app installed from a signed
 * listing (the global catalogue, a first-party release) is in no registry, and without its own
 * release its zone would read "not available" to everyone it was installed for. The release says
 * nothing a registry refusal hides: the server answers it only for an install this person sees.
 */
import type { AppInstall, AppListing } from 'citadel-workspace-client-ts';
import { getListing, listInstalls, setDisabledForMe, type AppsResult, type AppsTransport, type InstallsView } from '@/lib/workspace-service/apps-operations';
import { getRelease, type Release } from '@/lib/workspace-service/apps-runtime-operations';
import { adoptDisabledForMe } from '@/lib/citadel-apps/disabled-for-me';
import { adoptPeerForMe } from '@/lib/citadel-apps/peer-for-me';
import { listedApps, type ListedApp } from '@/lib/citadel-apps/listing-model';
import { readAppsAnswer, type AppsAnswer } from '@/lib/citadel-apps/wire/apps-answer';
import type { ZoneDataPort } from './app-zone-environment';

export function zoneDataFrom(transport: AppsTransport): ZoneDataPort {
  let installs: Promise<AppsResult<AppInstall[]>> | null = null;
  const listings: Map<string, Promise<AppsResult<ListedApp>>> = new Map();

  const readInstalls = (): Promise<AppsResult<AppInstall[]>> => {
    installs ??= listInstalls(transport).then((r: AppsResult<InstallsView>): AppsResult<AppInstall[]> => {
      if (!r.ok) return r;
      adoptDisabledForMe(r.value.disabledForMe);
      adoptPeerForMe(r.value.peerForMe);
      return { ok: true, value: r.value.installs };
    });
    return installs;
  };

  const listed = (listing: AppListing): AppsResult<ListedApp> => {
    const [app] = listedApps([listing]);
    return app === undefined ? { ok: false, refusal: 'Unavailable' } : { ok: true, value: app };
  };

  /** The release an install of `appId` that reaches this person runs; the registry's refusal when there is none. */
  const installedListing = async (appId: string, refused: AppsResult<ListedApp>): Promise<AppsResult<ListedApp>> => {
    const mine: AppsResult<AppInstall[]> = await readInstalls();
    const install: AppInstall | undefined = mine.ok ? mine.value.find((i: AppInstall) => i.app_id === appId) : undefined;
    if (install === undefined) return refused;
    const release: AppsResult<Release> = await getRelease(transport, install.id);
    return release.ok ? listed(release.value.current) : release;
  };

  const readListing = async (appId: string): Promise<AppsResult<ListedApp>> => {
    const r: AppsResult<AppListing> = await getListing(transport, appId);
    if (r.ok) return listed(r.value);
    // Only the server's refusal means "in no registry"; no answer, or one that does not read, is that failure.
    return r.refusal === 'NoAnswer' || r.refusal === 'Malformed' ? r : installedListing(appId, r);
  };

  return {
    installs: readInstalls,
    listing: (appId: string): Promise<AppsResult<ListedApp>> => {
      const held: Promise<AppsResult<ListedApp>> | undefined = listings.get(appId);
      if (held !== undefined) return held;
      const asked: Promise<AppsResult<ListedApp>> = readListing(appId);
      listings.set(appId, asked);
      return asked;
    },
    setDisabledForMe: (installId: string, disabled: boolean): Promise<AppsResult<boolean>> => setDisabledForMe(transport, installId, disabled),
  };
}

/** This tab's own answers, and the server's notice that another member changed an install. */
const CHANGES_INSTALLS: ReadonlySet<AppsAnswer['kind']> = new Set(['installed', 'updated', 'consented', 'uninstalled', 'installs-changed']);

/** Whether an apps answer (`workspace:apps`) changed what is installed, so a page's zones read again. */
export function changesInstalls(answer: unknown): boolean {
  return CHANGES_INSTALLS.has(readAppsAnswer(answer).kind);
}
