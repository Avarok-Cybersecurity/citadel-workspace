/**
 * The pane's side of booking (design §3.6.1): this instance answers bookings for its member
 * (booking-host.ts) on the planes the install holds, answers the requests left while they were
 * away once it is listening, and gives the booking page a client to claim with. As a booker, it
 * takes the hosts' answers to the requests this member left (booking-answers.ts) on mount and
 * whenever a host's answer is written. Until the
 * endpoint is up, or when the install may not call (`ihttp.call` for the relay, `ihttp.p2p.call`),
 * the client is null, and a booking is left as a request. The same endpoint answers the Calendar
 * SDK's routes for other apps in this member's session (sdk-host.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import type { IhttpClient } from '@/lib/citadel-apps/glue-sdk/ihttp-client';
import type { IhttpEndpoint } from '@/lib/citadel-apps/glue-sdk/ihttp-endpoint';
import type { Capability } from '@/lib/citadel-apps/host/capabilities';
import { BOOKING_ACK_PREFIX } from '@/lib/calendar/booking';
import { takeAnswers } from '@/lib/calendar/booking-answers';
import { BookingHost } from '@/lib/calendar/booking-host';
import { calendarHandler, calendarRoutes, serveCalendar } from '@/lib/calendar/calendar-endpoint';
import { SdkHost, type ConsentAnswer } from '@/lib/calendar/sdk-host';
import type { StorageChange } from '@/lib/citadel-apps/host/glue-instance';
import type { CalendarEngine } from '@/lib/calendar/engine/calendar-engine';
import type { CalendarPorts } from '@/lib/calendar/ports';

export interface Bookings {
  readonly client: IhttpClient | null;
  /** This instance's host side, for the host's own cancellations. */
  readonly host: BookingHost;
}

/** Whether `change` is a host's answer to a request on `node`. */
const isAnswerOn = (change: StorageChange, node: string): boolean =>
  typeof change.backend === 'object' && 'node_authored' in change.backend && change.backend.node_authored.node_id === node && change.key.startsWith(BOOKING_ACK_PREFIX);

/** `ask`: the member's answer to an app that wants to change their calendar (use-sdk-consent.ts). */
export function useBookings(ports: CalendarPorts, engine: CalendarEngine, node: string, me: string, held: ReadonlySet<Capability>, ask: (appId: string) => Promise<ConsentAnswer>): Bookings {
  const [client, setClient] = useState<IhttpClient | null>(null);
  const host: BookingHost = useMemo(() => new BookingHost({ ports, engine, node, me, nowMs: (): bigint => BigInt(Math.floor(ports.clock.now())) }), [ports, engine, node, me]);
  const sdk: SdkHost = useMemo(() => new SdkHost({ ports, engine, me, nowMs: (): bigint => BigInt(Math.floor(ports.clock.now())), newId: (): string => crypto.randomUUID(), ask }), [ports, engine, me, ask]);
  const relay: boolean = held.has('ihttp.serve');
  const p2p: boolean = held.has('ihttp.p2p.serve');
  const calls: boolean = held.has('ihttp.call') || held.has('ihttp.p2p.call');
  useEffect(() => {
    let live: boolean = true;
    let endpoint: IhttpEndpoint | null = null;
    serveCalendar(ports, calendarRoutes(engine), calendarHandler(sdk, host), relay || p2p ? { relay, p2p } : null).then(async (ep: IhttpEndpoint): Promise<void> => {
      if (!live) {
        ep.close();
        return;
      }
      endpoint = ep;
      if (calls) setClient(ep.client);
      await host.answerRequests();
    }).catch((e: unknown): void => { console.error('[calendar] bookings could not be served', e); });
    return (): void => {
      live = false;
      endpoint?.close();
      setClient(null);
    };
  }, [ports, engine, host, sdk, relay, p2p, calls]);
  useEffect(() => {
    // One take at a time, so an answer arriving during the mount's take is not taken (and told) twice.
    let turn: Promise<void> = Promise.resolve();
    const take = (): void => {
      turn = turn.then(async (): Promise<void> => { await takeAnswers({ ports, engine, node, me, nowMs: BigInt(Math.floor(ports.clock.now())) }); })
        .catch((e: unknown): void => { console.error('[calendar] answers to your requests could not be read', e); });
    };
    take();
    return ports.onStorageChanged((change: StorageChange): void => { if (isAnswerOn(change, node)) take(); });
  }, [ports, engine, node, me]);
  return { client, host };
}
