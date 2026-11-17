/**
 * What the Calendar keeps about the apps that use its SDK (design §3.8), all in the member's own
 * storage: their answer for each app (`cal/sdk/allow/<app_id>`, the core's `Consent`), and an
 * index of the events each app added (`cal/sdk/index/<app_id>/<event_id>`, the core's
 * `Placement`), which says where each one is kept and is the count the per-app limit reads.
 *
 * Each answer is its own key rather than a field of `cal/settings`, so saving a display zone and
 * answering an app can never overwrite one another.
 */
import type { CalendarEngine } from './engine/calendar-engine';
import type { Consent } from './generated/Consent';
import type { Placement } from './generated/Placement';
import type { CalendarPorts, CalendarStore } from './ports';
import { EVENT_PREFIX, PRIVATE_PREFIX } from './read-sources';

export const SDK_ALLOW_PREFIX: string = 'cal/sdk/allow/';
export const SDK_INDEX_PREFIX: string = 'cal/sdk/index/';

const USER: CalendarStore = { kind: 'user' };
type Sdk = Pick<CalendarEngine, 'sdk'>;

export async function readConsent(ports: CalendarPorts, engine: Sdk, appId: string): Promise<Consent | null> {
  const bytes: Uint8Array | null = await ports.storage.get(USER, `${SDK_ALLOW_PREFIX}${appId}`);
  return bytes === null ? null : engine.sdk.decodeConsent(bytes);
}

export const saveConsent = (ports: CalendarPorts, engine: Sdk, appId: string, consent: Consent): Promise<void> =>
  ports.storage.set(USER, `${SDK_ALLOW_PREFIX}${appId}`, engine.sdk.encodeConsent(consent));

/** The member takes their answer back: the app is asked again next time. */
export const forgetConsent = (ports: CalendarPorts, appId: string): Promise<void> => ports.storage.remove(USER, `${SDK_ALLOW_PREFIX}${appId}`);

export interface AppConsent {
  readonly appId: string;
  readonly consent: Consent;
}

/** Every app the member answered, by app id. */
export async function readConsents(ports: CalendarPorts, engine: Sdk): Promise<AppConsent[]> {
  const keys: string[] = await ports.storage.keys(USER, SDK_ALLOW_PREFIX);
  const got: (AppConsent | null)[] = await Promise.all(keys.map(async (key: string): Promise<AppConsent | null> => {
    const consent: Consent | null = await readConsent(ports, engine, key.slice(SDK_ALLOW_PREFIX.length));
    return consent === null ? null : { appId: key.slice(SDK_ALLOW_PREFIX.length), consent };
  }));
  return got.filter((c): c is AppConsent => c !== null).sort((a, b) => a.appId.localeCompare(b.appId));
}

const indexKey = (appId: string, id: string): string => `${SDK_INDEX_PREFIX}${appId}/${id}`;

/** Where `appId`'s event `id` is kept, or null when the app did not add one by that id. */
export async function placementOf(ports: CalendarPorts, engine: Sdk, appId: string, id: string): Promise<Placement | null> {
  const bytes: Uint8Array | null = await ports.storage.get(USER, indexKey(appId, id));
  return bytes === null ? null : engine.sdk.decodePlacement(bytes);
}

export const keepPlacement = (ports: CalendarPorts, engine: Sdk, appId: string, id: string, placement: Placement): Promise<void> =>
  ports.storage.set(USER, indexKey(appId, id), engine.sdk.encodePlacement(placement));

export const dropPlacement = (ports: CalendarPorts, appId: string, id: string): Promise<void> => ports.storage.remove(USER, indexKey(appId, id));

/** How many events `appId` keeps in the member's calendar. */
export async function keptBy(ports: CalendarPorts, appId: string): Promise<number> {
  return (await ports.storage.keys(USER, `${SDK_INDEX_PREFIX}${appId}/`)).length;
}

/** The store and key an event at `placement` lives at: the member's own, or posted on the node under their name. */
export function whereKept(placement: Placement, me: string, id: string): { store: CalendarStore; key: string } {
  if (placement === 'private') return { store: USER, key: `${PRIVATE_PREFIX}${id}` };
  return { store: { kind: 'authored', node: placement.authored.node, author: me }, key: `${EVENT_PREFIX}${id}` };
}
