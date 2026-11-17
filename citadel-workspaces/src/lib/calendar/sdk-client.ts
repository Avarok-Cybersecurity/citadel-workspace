/**
 * The Calendar SDK for glue apps in the page (design §3.8), the mirror of the Rust crate
 * `citadel-calendar-sdk`: the same routes, requests built and answers read through the Calendar's
 * engine (engine.sdk), so it uses the core's one definition of every body, query and refusal.
 *
 * Every call goes to the Calendar in the member's own session. An answer is `{ ok }`, the
 * Calendar's `{ refused }` (its `SdkRefusal`), or `{ failed }` when no Calendar answered with the
 * wire: a transport failure, or a status and body that do not belong together.
 */
import type { IhttpClient, IhttpResponse } from '@/lib/citadel-apps/glue-sdk/ihttp-client';
import type { Address } from '@/lib/citadel-apps/sdk/generated/Address';
import type { HttpMethod } from '@/lib/citadel-apps/sdk/generated/HttpMethod';
import { CALENDAR_APP_ID } from './app-id';
import type { SdkEngine } from './engine/sdk-engine';
import type { EventPatch } from './generated/EventPatch';
import type { EventRef } from './generated/EventRef';
import type { Events } from './generated/Events';
import type { FreeBusy } from './generated/FreeBusy';
import type { FreeBusyQuery } from './generated/FreeBusyQuery';
import type { Health } from './generated/Health';
import type { ListQuery } from './generated/ListQuery';
import type { NewEvent } from './generated/NewEvent';
import type { SdkRefusal } from './generated/SdkRefusal';
import type { Rev } from './generated/Rev';

export type SdkCall<T> = { readonly ok: T } | { readonly refused: SdkRefusal } | { readonly failed: string };

const EMPTY: Uint8Array = new Uint8Array();

export class CalendarSdk {
  private readonly to: Address;

  /** `me`: the member this app runs for, whose Calendar it calls. */
  constructor(private readonly client: IhttpClient, private readonly sdk: SdkEngine, me: string) {
    this.to = { user: { app_id: CALENDAR_APP_ID, username: me } };
  }

  addEvent(event: NewEvent): Promise<SdkCall<EventRef>> {
    return this.call('POST', '/events', '', this.sdk.encodeNewEvent(event), 201, this.sdk.decodeEventRef);
  }

  /** The new revision. */
  async updateEvent(id: string, patch: EventPatch): Promise<SdkCall<number>> {
    const r: SdkCall<Rev> = await this.call('PATCH', this.sdk.eventPath(id), '', this.sdk.encodeEventPatch(patch), 200, this.sdk.decodeRev);
    return 'ok' in r ? { ok: r.ok.rev } : r;
  }

  removeEvent(id: string, rev: number): Promise<SdkCall<null>> {
    return this.call('DELETE', this.sdk.eventPath(id), '', this.sdk.encodeRev({ rev }), 204, (b: Uint8Array): null => {
      if (b.length !== 0) throw new Error('a 204 with a body');
      return null;
    });
  }

  list(query: ListQuery): Promise<SdkCall<Events>> {
    return this.call('GET', '/events', this.sdk.listQueryString(query), EMPTY, 200, this.sdk.decodeEvents);
  }

  freeBusy(query: FreeBusyQuery): Promise<SdkCall<FreeBusy>> {
    return this.call('GET', '/free-busy', this.sdk.freeBusyQueryString(query), EMPTY, 200, this.sdk.decodeFreeBusy);
  }

  health(): Promise<SdkCall<Health>> {
    return this.call('GET', '/health', '', EMPTY, 200, this.sdk.decodeHealth);
  }

  private async call<T>(method: HttpMethod, path: string, query: string, body: Uint8Array, ok: number, decode: (b: Uint8Array) => T): Promise<SdkCall<T>> {
    let r: IhttpResponse;
    try {
      r = await this.client.request(this.to, 'relay', method, path, query, body);
    } catch (e: unknown) {
      return { failed: e instanceof Error ? e.message : String(e) };
    }
    try {
      if (r.status === ok) return { ok: decode(r.body) };
      const refused: SdkRefusal = this.sdk.decodeRefusal(r.body);
      if (this.sdk.status(refused) === r.status) return { refused };
    } catch {
      // Not the wire's: said below, with the status.
    }
    return { failed: `the Calendar answered ${r.status} with a body that is not the SDK's` };
  }
}
