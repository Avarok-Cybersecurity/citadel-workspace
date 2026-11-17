/**
 * The admin Telemetry section's pure rules: the log filter a form describes, and the policy and
 * support-access grants the server would accept (the server re-checks every one of them).
 */
import type { TelemetryFilter, TelemetryLevel, TelemetrySettings } from 'citadel-workspace-client-ts';

export interface FilterForm {
  user: string;
  /** The text typed in the field; filterFromForm turns it into the bigint CID. */
  peerCidText: string;
  /** '' for any level, else the lowest level shown. */
  minLevel: '' | TelemetryLevel;
  /** `datetime-local` values: local time, '' for no bound. */
  since: string;
  until: string;
}

export const EMPTY_FILTER_FORM: FilterForm = { user: '', peerCidText: '', minLevel: '', since: '', until: '' };

const U64_MAX: bigint = 2n ** 64n - 1n;

export type FilterResult = { ok: true; filter: TelemetryFilter } | { ok: false; problem: string };

function localMs(value: string): bigint | null | undefined {
  if (value === '') return null;
  const ms: number = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : BigInt(ms);
}

export function filterFromForm(form: FilterForm): FilterResult {
  const peer: string = form.peerCidText.trim();
  if (peer !== '' && (!/^\d+$/.test(peer) || BigInt(peer) > U64_MAX)) return { ok: false, problem: 'A peer CID is a whole number.' };
  const since: bigint | null | undefined = localMs(form.since);
  const until: bigint | null | undefined = localMs(form.until);
  if (since === undefined || until === undefined) return { ok: false, problem: 'Enter a valid date and time.' };
  if (since !== null && until !== null && since > until) return { ok: false, problem: 'The start must be before the end.' };
  return {
    ok: true,
    filter: {
      user_id: form.user.trim() === '' ? null : form.user.trim(),
      peer_cid: peer === '' ? null : BigInt(peer),
      min_level: form.minLevel === '' ? null : form.minLevel,
      since_ms: since,
      until_ms: until,
    },
  };
}

const MB: bigint = 1024n * 1024n;

export type PolicyResult = { ok: true; retentionDays: number; perUserBytes: bigint } | { ok: false; problem: string };

/** Whole days and megabytes, each at least 1 and within what the server reports it allows. */
export function policyFromForm(days: string, megabytes: string, settings: TelemetrySettings): PolicyResult {
  if (!/^\d+$/.test(days) || Number(days) < 1) return { ok: false, problem: 'Retention is a whole number of days, at least 1.' };
  if (Number(days) > settings.max_retention_days) return { ok: false, problem: `Retention can be at most ${settings.max_retention_days} days.` };
  if (!/^\d+$/.test(megabytes) || BigInt(megabytes) < 1n) return { ok: false, problem: 'Storage is a whole number of megabytes, at least 1.' };
  const bytes: bigint = BigInt(megabytes) * MB;
  if (bytes > settings.max_per_user_bytes) return { ok: false, problem: `Storage can be at most ${settings.max_per_user_bytes / MB} MB per person.` };
  return { ok: true, retentionDays: Number(days), perUserBytes: bytes };
}

export const megabytesOf = (bytes: bigint): string => (bytes / MB).toString();

/** How long a support-access grant may run. Under the platform's 30-day ceiling, which is measured by the server's clock. */
export const SUPPORT_ACCESS_DAYS: readonly number[] = [1, 7, 14];

export function supportAccessUntil(days: number, nowMs: number): bigint {
  return BigInt(nowMs) + BigInt(days) * 86_400_000n;
}
