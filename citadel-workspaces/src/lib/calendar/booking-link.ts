/**
 * The member deep link (design §3.1 "Booking pages", §3.6.1 step 1): "book with Ana on Platform",
 * optionally one of her types, as a workspace link to the node's Calendar tab
 * (`/workspace?nodeId=<id>&tab=app:net.avarok.calendar&book=<username>[&type=<id>]`, the node-tab
 * deep link of `lib/node-tabs/tab-memory.ts` with the booking named). Links stay inside the
 * workspace: a member who cannot see the node cannot follow it.
 */
import { CALENDAR_APP_ID } from './app-id';

export const BOOK_PARAM: string = 'book';
export const TYPE_PARAM: string = 'type';
const TAB: string = `app:${CALENDAR_APP_ID}`;

export interface BookingTarget {
  readonly node: string;
  readonly host: string;
  readonly typeId: string | null;
}

export function bookingLink(origin: string, target: BookingTarget): string {
  const params: URLSearchParams = new URLSearchParams({ nodeId: target.node, tab: TAB, [BOOK_PARAM]: target.host });
  if (target.typeId !== null) params.set(TYPE_PARAM, target.typeId);
  return `${origin}/workspace?${params.toString()}`;
}

/** A node's Calendar tab, where its team types and members' pages are chosen from. */
export const calendarTabLink = (origin: string, node: string): string => `${origin}/workspace?${new URLSearchParams({ nodeId: node, tab: TAB }).toString()}`;

/** The booking a page address names for `node`'s Calendar tab, or null. */
export function bookingTargetOf(search: string, node: string): BookingTarget | null {
  const params: URLSearchParams = new URLSearchParams(search);
  const host: string | null = params.get(BOOK_PARAM);
  if (params.get('nodeId') !== node || params.get('tab') !== TAB || host === null || host.trim() === '') return null;
  const typeId: string | null = params.get(TYPE_PARAM);
  return { node, host: host.trim(), typeId: typeId === null || typeId === '' ? null : typeId };
}
