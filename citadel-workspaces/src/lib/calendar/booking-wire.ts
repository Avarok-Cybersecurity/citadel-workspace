/**
 * The booking protocol on the wire (design §3.6.1): the routes a host's instance serves, and the
 * bodies that are not a `Booking` (which crosses in the core's own codec). Every body is CBOR,
 * versioned; a body that does not decode is null, and the host answers 400.
 */
import { decodeCbor, encodeCbor, isCborMap, type Decoded } from '@/lib/citadel-apps/host/cbor';
import type { Route } from '@/lib/citadel-apps/sdk/generated/Route';
import type { Interval } from './generated/Interval';

const WIRE_VERSION: number = 1;

export const BOOK_PATH: string = '/book';
export const cancelPath = (id: string): string => `/book/${encodeURIComponent(id)}/cancel`;
export const reschedulePath = (id: string): string => `/book/${encodeURIComponent(id)}/reschedule`;
export const BOOKING_ROUTES: readonly Route[] = [
  { method: 'POST', path: BOOK_PATH },
  { method: 'POST', path: '/book/:id/cancel' },
  { method: 'POST', path: '/book/:id/reschedule' },
];

export type BookingRoute = { kind: 'book' } | { kind: 'cancel'; id: string } | { kind: 'reschedule'; id: string };

export function routeOf(path: string): BookingRoute | null {
  if (path === BOOK_PATH) return { kind: 'book' };
  const m: RegExpExecArray | null = /^\/book\/([^/]+)\/(cancel|reschedule)$/.exec(path);
  if (m === null) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1] as string);
  } catch {
    return null;
  }
  return m[2] === 'cancel' ? { kind: 'cancel', id } : { kind: 'reschedule', id };
}

const ms = (v: unknown): bigint | null => (typeof v === 'bigint' ? v : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);

function versioned(bytes: Uint8Array): Readonly<Record<string, unknown>> | null {
  const d: Decoded = decodeCbor(bytes);
  return d.ok && isCborMap(d.value) && d.value.v === WIRE_VERSION ? d.value : null;
}

export const encodeAlternatives = (alternatives: readonly Interval[]): Uint8Array =>
  encodeCbor({ v: WIRE_VERSION, alternatives: alternatives.map((a: Interval) => ({ start_ms: a.start_ms, end_ms: a.end_ms })) });

export function decodeAlternatives(bytes: Uint8Array): Interval[] | null {
  const m: Readonly<Record<string, unknown>> | null = versioned(bytes);
  if (m === null || !Array.isArray(m.alternatives)) return null;
  const out: Interval[] = [];
  for (const a of m.alternatives as unknown[]) {
    if (!isCborMap(a)) return null;
    const start: bigint | null = ms(a.start_ms);
    const end: bigint | null = ms(a.end_ms);
    if (start === null || end === null || end <= start) return null;
    out.push({ start_ms: start, end_ms: end });
  }
  return out;
}

/** Why a booking is cancelled, in the canceller's words; null for no reason given. */
export const encodeCancel = (reason: string | null): Uint8Array => encodeCbor({ v: WIRE_VERSION, reason });

export function decodeCancel(bytes: Uint8Array): { reason: string | null } | null {
  const m: Readonly<Record<string, unknown>> | null = versioned(bytes);
  if (m === null || !(m.reason === null || typeof m.reason === 'string')) return null;
  return { reason: m.reason === null ? null : (m.reason as string) };
}

/** A refusal's reason, in words, as the host's answer body. */
export const encodeReason = (reason: string): Uint8Array => encodeCbor({ v: WIRE_VERSION, reason });

export function decodeReason(bytes: Uint8Array): string | null {
  const m: Readonly<Record<string, unknown>> | null = versioned(bytes);
  return m !== null && typeof m.reason === 'string' ? m.reason : null;
}
