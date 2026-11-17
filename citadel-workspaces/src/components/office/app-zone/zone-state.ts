/**
 * What an app zone shows, decided from what is known: the zone's own props (written by the page's
 * author), the app's listing (or the uniform "not available"), the installs that cover this
 * person on this page, and whether they may install for themselves. Pure.
 *
 * A zone never runs anything here: `ready` is where the runtime's seam mounts a host-owned canvas
 * (app-zone-runtime.ts); until it does, `ready` draws a placeholder too.
 */
import type { AppInstall, PeerForMe } from 'citadel-workspace-client-ts';
import { covers } from '@/lib/citadel-apps/install-covers';
import { compareVersions, isAppId, parseAppVersion, type AppVersion } from '@/lib/citadel-apps/app-identity';
import type { ListedApp } from '@/lib/citadel-apps/listing-model';
import { memberAsks, needsMemberPrompt } from '@/lib/citadel-apps/consent-model';
import type { Tri } from '@/lib/citadel-apps/scope-options';
import { runsOn, type Placement } from '@/lib/citadel-apps/runtime/placement';

export const MAX_ZONE_HEIGHT: number = 2000;
const ZONE_ID: RegExp = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface ZoneProps {
  app: string;
  zone: string;
  height: number;
  /** The lowest version the zone works with, from the optional `min` prop. */
  floor: AppVersion | null;
}

/** The zone's props, or what is wrong with them: the author's text, checked like any input. */
export function readZoneProps(app: unknown, zone: unknown, height: unknown, min: unknown): ZoneProps | string {
  if (typeof app !== 'string' || !isAppId(app)) return 'its app is not an app id';
  if (typeof zone !== 'string' || !ZONE_ID.test(zone)) return 'its zone name is missing or malformed';
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > MAX_ZONE_HEIGHT) return `its height is not a whole number from 1 to ${MAX_ZONE_HEIGHT}`;
  if (min !== undefined && (typeof min !== 'string' || parseAppVersion(min) === null)) return 'its min is not a version';
  return { app, zone, height, floor: typeof min === 'string' ? parseAppVersion(min) : null };
}

export interface ZoneFacts {
  listing: 'loading' | 'unavailable' | ListedApp;
  installs: 'loading' | 'unavailable' | readonly AppInstall[];
  me: string | null;
  nodeId: string;
  /** The page's ancestors, nearest first. */
  ancestors: readonly string[];
  disabledForMe: ReadonlySet<string>;
  /** This person's own P2P and topic answers, per install (peer-for-me.ts). */
  peerForMe: ReadonlyMap<string, PeerForMe>;
  mayInstall: Tri;
}

export type ZoneView =
  | { kind: 'loading' }
  | { kind: 'not-available' }
  /** The app's manifest does not list the surface it is placed on (`md_zone` for a zone, `node_tab` for a tab). */
  | { kind: 'wrong-surface'; name: string }
  | { kind: 'install'; name: string }
  | { kind: 'ask-admin'; name: string }
  | { kind: 'disabled'; name: string; install: AppInstall }
  | { kind: 'needs-consent'; name: string; version: string }
  | { kind: 'suspended'; name: string }
  | { kind: 'outdated'; name: string; installed: string }
  /** Granted P2P or topics this person has not answered: the app starts once they have, holding what they allowed. */
  | { kind: 'needs-answer'; name: string }
  | { kind: 'ready'; app: ListedApp; install: AppInstall };

export function zoneView(props: ZoneProps, f: ZoneFacts, placed: Placement['kind']): ZoneView {
  if (f.listing === 'unavailable' || f.installs === 'unavailable') return { kind: 'not-available' };
  if (f.listing === 'loading' || f.installs === 'loading' || f.me === null) return { kind: 'loading' };
  const name: string = f.listing.manifest.name;
  if (!runsOn(f.listing.manifest, placed)) return { kind: 'wrong-surface', name };
  const me: string = f.me;
  const covering: AppInstall[] = f.installs.filter((i: AppInstall) => i.app_id === props.app && covers(i.scope, me, f.nodeId, f.ancestors));
  if (covering.length === 0) return f.mayInstall === 'yes' ? { kind: 'install', name } : f.mayInstall === 'no' ? { kind: 'ask-admin', name } : { kind: 'loading' };
  const enabled: AppInstall[] = covering.filter((i: AppInstall) => !f.disabledForMe.has(i.id));
  if (enabled.length === 0) return { kind: 'disabled', name, install: covering[0] };
  const active: AppInstall | undefined = enabled.find((i: AppInstall) => i.state === 'Active');
  if (active === undefined) {
    const s: AppInstall['state'] = enabled[0].state;
    return typeof s === 'object' && 'NeedsConsent' in s ? { kind: 'needs-consent', name, version: s.NeedsConsent.version } : { kind: 'suspended', name };
  }
  const installed: AppVersion | null = parseAppVersion(active.version);
  if (props.floor !== null && (installed === null || compareVersions(installed, props.floor) < 0)) return { kind: 'outdated', name, installed: active.version };
  // An instance holds the answers it started with (runtime/peer-ports.ts), so it starts only after them.
  if (needsMemberPrompt(memberAsks(active.granted, f.peerForMe.get(active.id)?.consent ?? null))) return { kind: 'needs-answer', name };
  return { kind: 'ready', app: f.listing, install: active };
}
