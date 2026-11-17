/**
 * The Calendar instance's internal HTTP (design §3.6.1, §3.8): one endpoint answering both the
 * booking routes (booking-host.ts) and the SDK's (sdk-host.ts), listening first so no frame is
 * missed, then advertising every route it answers on the planes the install holds. With neither
 * plane held it serves nothing, and bookers leave requests instead.
 */
import { ihttpEndpoint, type IhttpEndpoint } from '@/lib/citadel-apps/glue-sdk/ihttp-endpoint';
import type { IhttpMessage } from '@/lib/citadel-apps/glue-sdk/ihttp-io';
import type { IhttpHandler, IhttpRequest } from '@/lib/citadel-apps/glue-sdk/ihttp-server';
import type { Route } from '@/lib/citadel-apps/sdk/generated/Route';
import type { ServeOn } from '@/lib/citadel-apps/sdk/generated/ServeOn';
import type { BookingHost } from './booking-host';
import { BOOKING_ROUTES } from './booking-wire';
import type { CalendarEngine } from './engine/calendar-engine';
import type { CalendarPorts } from './ports';
import type { SdkHost } from './sdk-host';

/** Every route the Calendar serves: what its manifest's `ihttp.serve` must list. */
export const calendarRoutes = (engine: Pick<CalendarEngine, 'sdk'>): Route[] => [...BOOKING_ROUTES, ...engine.sdk.routes()];

/** An SDK request to the SDK's host, anything else to the booking host. */
export const calendarHandler = (sdk: SdkHost, bookings: BookingHost): IhttpHandler =>
  (request: IhttpRequest): Promise<IhttpMessage> => (sdk.owns(request) ? sdk.handle(request) : bookings.handle(request));

export async function serveCalendar(ports: CalendarPorts, routes: readonly Route[], handler: IhttpHandler, on: ServeOn | null): Promise<IhttpEndpoint> {
  const endpoint: IhttpEndpoint = ihttpEndpoint(ports.ihttp, handler);
  if (on !== null) await ports.ihttp.serve(routes, on);
  return endpoint;
}
