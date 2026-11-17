/**
 * The member's Calendar notification settings, kept per account in `storage.user` beside their
 * other Calendar settings (zones.ts `cal/settings`), at their own key so a save of one never
 * overwrites the other. What they decide: whether the Calendar notifies at all, which kinds of
 * notice it raises, the reminders a new event starts with, and whether a notice may also reach
 * the system's notification centre or stays in the page's notification list.
 *
 * Nothing here reads a store or a clock (use-notify-prefs.ts, notice-gate.ts).
 */
import { decodeCbor, encodeCbor, type Decoded } from '@/lib/citadel-apps/host/cbor';

export type NoticeKind = 'reminders' | 'invitations' | 'bookings' | 'polls';
export const NOTICE_KINDS: readonly NoticeKind[] = ['reminders', 'invitations', 'bookings', 'polls'];

/** `in_app`: the page's notification list only; `system`: also the system's, when the browser allows it. */
export type NoticeDelivery = 'in_app' | 'system';

export interface NotifyPrefs {
  readonly enabled: boolean;
  readonly kinds: Readonly<Record<NoticeKind, boolean>>;
  /** Minutes before the start a new event's reminders are set to; the member changes them per event. */
  readonly leadMinutes: readonly number[];
  readonly delivery: NoticeDelivery;
}

export const NOTIFY_PREFS_KEY: string = 'cal/settings/notifications';
const PREFS_VERSION: number = 1;

/**
 * What the Calendar does for a member who has not chosen: every kind, in the page and the system,
 * and new events with no reminder, which is what it did before there was a choice to make.
 */
export const PREFS_BEFORE_CHOICE: NotifyPrefs = {
  enabled: true,
  kinds: { reminders: true, invitations: true, bookings: true, polls: true },
  leadMinutes: [],
  delivery: 'system',
};

/** The lead times offered, in minutes, here and in the event editor; one an event already has is offered too. */
export const LEAD_CHOICES: readonly number[] = [10, 30, 60, 24 * 60];

export const leadLabel = (minutes: number): string =>
  minutes % (24 * 60) === 0 ? `${minutes / (24 * 60)} day${minutes === 24 * 60 ? '' : 's'} before`
    : minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'} before` : `${minutes} minutes before`;

export function allows(prefs: NotifyPrefs, kind: NoticeKind): boolean {
  return prefs.enabled && prefs.kinds[kind];
}

export function encodePrefs(prefs: NotifyPrefs): Uint8Array {
  return encodeCbor({
    v: PREFS_VERSION,
    enabled: prefs.enabled,
    kinds: NOTICE_KINDS.filter((k: NoticeKind) => prefs.kinds[k]),
    lead: [...new Set(prefs.leadMinutes)].sort((a: number, b: number) => a - b),
    delivery: prefs.delivery,
  });
}

const isLead = (m: unknown): m is number => typeof m === 'number' && Number.isInteger(m) && m >= 0 && m <= 7 * 24 * 60;
const isKind = (k: unknown): k is NoticeKind => typeof k === 'string' && (NOTICE_KINDS as readonly string[]).includes(k);

/** The settings, or null when the bytes are not version-1 settings: the caller says so and shows what applies. */
export function decodePrefs(bytes: Uint8Array): NotifyPrefs | null {
  const decoded: Decoded = decodeCbor(bytes);
  if (!decoded.ok || typeof decoded.value !== 'object' || decoded.value === null) return null;
  const { v, enabled, kinds, lead, delivery } = decoded.value as Record<string, unknown>;
  if (v !== PREFS_VERSION || typeof enabled !== 'boolean') return null;
  if (!Array.isArray(kinds) || !kinds.every(isKind) || !Array.isArray(lead) || !lead.every(isLead)) return null;
  if (delivery !== 'in_app' && delivery !== 'system') return null;
  const on: ReadonlySet<NoticeKind> = new Set<NoticeKind>(kinds);
  return {
    enabled,
    kinds: { reminders: on.has('reminders'), invitations: on.has('invitations'), bookings: on.has('bookings'), polls: on.has('polls') },
    leadMinutes: lead,
    delivery,
  };
}
