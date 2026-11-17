/**
 * The Calendar SDK's wire and decisions, typed (design §3.8): calendar-core's one definition, which
 * the Calendar's instance answers requests with and the page's mirror (sdk-client.ts) builds them
 * with. Reached as `CalendarEngine.sdk`. A decision is an `SdkAnswer`, `{ ok } | { refused }`; a
 * body that does not decode throws a `CalendarRefusal` as everywhere in the engine.
 */
import type { Route } from '@/lib/citadel-apps/sdk/generated/Route';
import type { HttpMethod } from '@/lib/citadel-apps/sdk/generated/HttpMethod';
import type { Adding } from '../generated/Adding';
import type { Consent } from '../generated/Consent';
import type { Event } from '../generated/Event';
import type { EventPatch } from '../generated/EventPatch';
import type { EventRef } from '../generated/EventRef';
import type { EventView } from '../generated/EventView';
import type { Events } from '../generated/Events';
import type { FreeBusy } from '../generated/FreeBusy';
import type { FreeBusyQuery } from '../generated/FreeBusyQuery';
import type { Gate } from '../generated/Gate';
import type { Health } from '../generated/Health';
import type { Include } from '../generated/Include';
import type { ListQuery } from '../generated/ListQuery';
import type { NewEvent } from '../generated/NewEvent';
import type { Placement } from '../generated/Placement';
import type { Projection } from '../generated/Projection';
import type { Rev } from '../generated/Rev';
import type { SdkAnswer } from '../generated/SdkAnswer';
import type { SdkRefusal } from '../generated/SdkRefusal';
import type { SdkRoute } from '../generated/SdkRoute';
import { call } from './call';
import type { CalendarGlue } from './load-calendar-wasm';

export class SdkEngine {
  constructor(private readonly glue: CalendarGlue) {}

  routes(): Route[] {
    return call((): unknown => this.glue.sdkRoutes());
  }
  route(method: HttpMethod, path: string): SdkRoute | null {
    return call((): unknown => this.glue.sdkRoute(method, path));
  }
  health(): Health {
    return call((): unknown => this.glue.sdkHealth());
  }
  eventPath(id: string): string {
    return this.glue.eventPath(id);
  }
  listQueryString(q: ListQuery): string {
    return call((): unknown => this.glue.listQueryString(q));
  }
  parseListQuery(query: string): SdkAnswer<ListQuery> {
    return call((): unknown => this.glue.parseListQuery(query));
  }
  freeBusyQueryString(q: FreeBusyQuery): string {
    return call((): unknown => this.glue.freeBusyQueryString(q));
  }
  parseFreeBusyQuery(query: string): SdkAnswer<FreeBusyQuery> {
    return call((): unknown => this.glue.parseFreeBusyQuery(query));
  }
  gate(route: SdkRoute, caller: string, acting: string, consent: Consent | null): Gate {
    return call((): unknown => this.glue.sdkGate(route, caller, acting, consent));
  }
  /** The instants to keep, `nowMs` included, or null when one more change does not fit. */
  rateAdmit(recentMs: readonly bigint[], nowMs: bigint): bigint[] | null {
    return call((): unknown => this.glue.sdkRateAdmit([...recentMs], nowMs));
  }
  newEvent(request: NewEvent, adding: Adding): SdkAnswer<[Event, Placement]> {
    return call((): unknown => this.glue.newSdkEvent(request, adding));
  }
  patchEvent(event: Event, patch: EventPatch, appId: string, nowMs: bigint): SdkAnswer<Event> {
    return call((): unknown => this.glue.patchSdkEvent(event, patch, appId, nowMs));
  }
  mayChange(event: Event, appId: string, rev: number): SdkAnswer<null> {
    return call((): unknown => this.glue.mayChangeSdkEvent(event, appId, rev));
  }
  /** The HTTP status a refusal is answered with: its code's, as the core states it. */
  status(refusal: SdkRefusal): number {
    return call((): unknown => this.glue.sdkStatus(refusal.code));
  }
  view(event: Event, include: Include): EventView | null {
    return call((): unknown => this.glue.sdkView(event, include));
  }
  projectionView(eventId: string, projection: Projection): EventView {
    return call((): unknown => this.glue.sdkProjectionView(eventId, projection));
  }

  encodeNewEvent = (v: NewEvent): Uint8Array => call((): unknown => this.glue.encodeNewEvent(v));
  decodeNewEvent = (b: Uint8Array): NewEvent => call((): unknown => this.glue.decodeNewEvent(b));
  encodeEventPatch = (v: EventPatch): Uint8Array => call((): unknown => this.glue.encodeEventPatch(v));
  decodeEventPatch = (b: Uint8Array): EventPatch => call((): unknown => this.glue.decodeEventPatch(b));
  encodeRev = (v: Rev): Uint8Array => call((): unknown => this.glue.encodeRev(v));
  decodeRev = (b: Uint8Array): Rev => call((): unknown => this.glue.decodeRev(b));
  encodeEventRef = (v: EventRef): Uint8Array => call((): unknown => this.glue.encodeEventRef(v));
  decodeEventRef = (b: Uint8Array): EventRef => call((): unknown => this.glue.decodeEventRef(b));
  encodeEvents = (v: Events): Uint8Array => call((): unknown => this.glue.encodeEvents(v));
  decodeEvents = (b: Uint8Array): Events => call((): unknown => this.glue.decodeEvents(b));
  encodeFreeBusy = (v: FreeBusy): Uint8Array => call((): unknown => this.glue.encodeFreeBusy(v));
  decodeFreeBusy = (b: Uint8Array): FreeBusy => call((): unknown => this.glue.decodeFreeBusy(b));
  encodeHealth = (v: Health): Uint8Array => call((): unknown => this.glue.encodeHealth(v));
  decodeHealth = (b: Uint8Array): Health => call((): unknown => this.glue.decodeHealth(b));
  encodeRefusal = (v: SdkRefusal): Uint8Array => call((): unknown => this.glue.encodeSdkRefusal(v));
  decodeRefusal = (b: Uint8Array): SdkRefusal => call((): unknown => this.glue.decodeSdkRefusal(b));
  encodeConsent = (v: Consent): Uint8Array => call((): unknown => this.glue.encodeConsent(v));
  decodeConsent = (b: Uint8Array): Consent => call((): unknown => this.glue.decodeConsent(b));
  encodePlacement = (v: Placement): Uint8Array => call((): unknown => this.glue.encodePlacement(v));
  decodePlacement = (b: Uint8Array): Placement => call((): unknown => this.glue.decodePlacement(b));
}

