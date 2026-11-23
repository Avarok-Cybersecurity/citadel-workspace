/**
 * The agent's word that a session's resume credential has run out (`ResumeCredentialExpired`),
 * and what the tab that owns the session shows for it: one notice that stays until answered,
 * whose action opens that account's sign-in.
 *
 * The session is still connected when this arrives. Its next dropped connection will not come
 * back by itself, so the notice says that rather than "signed out". Pure.
 */
import type { ResponseType } from 'citadel-workspace-client-ts';
import { accountLinkPath } from '@/lib/onboarding/account-link';
import { RESUME_EXPIRED_TOAST } from './copy';

export const RESUME_EXPIRED_NOTIFICATION: 'ResumeCredentialExpired' = 'ResumeCredentialExpired' satisfies ResponseType;

export interface ResumeExpired { cid: bigint; validUntilUtc: bigint }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBigint(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
}

/** The notification in `message`, bare or under `Response`, or null for anything else. */
export function readResumeExpired(message: unknown): ResumeExpired | null {
  if (!isRecord(message)) return null;
  const root: Record<string, unknown> = isRecord(message.Response) ? message.Response : message;
  const body: unknown = root[RESUME_EXPIRED_NOTIFICATION];
  if (!isRecord(body)) return null;
  const cid: bigint | null = asBigint(body.cid);
  const validUntilUtc: bigint | null = asBigint(body.valid_until_utc);
  return cid === null || validUntilUtc === null ? null : { cid, validUntilUtc };
}

export interface ResumeExpiredNotice { id: string; title: string; description: string; action: string; signInPath: string }

/** What to show the tab whose session `own` is, for `expired`; null when it is another session's. */
export function resumeExpiredNotice(expired: ResumeExpired, own: { cid: bigint; username: string; server: string }): ResumeExpiredNotice | null {
  if (expired.cid !== own.cid) return null;
  return {
    id: RESUME_EXPIRED_TOAST.id(own.cid),
    title: RESUME_EXPIRED_TOAST.title,
    description: RESUME_EXPIRED_TOAST.description(own.server),
    action: RESUME_EXPIRED_TOAST.action,
    signInPath: accountLinkPath({ username: own.username, server: own.server, open: { kind: 'sign-in' } }),
  };
}
