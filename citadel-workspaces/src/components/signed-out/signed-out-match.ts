/**
 * Which signed-out entry, if any, belongs to a saved account.
 *
 * By CID when the saved record has one: a CID is permanent per account, and a
 * username is unique only per server. An older saved record without a CID falls
 * back to the username, the only other thing both sides carry.
 */
import type { SignedOutAccount } from '@/types/session-types';

export function signedOutReasonFor(account: { cid?: bigint; username: string }, signedOut: readonly SignedOutAccount[]): string | null {
  const match: SignedOutAccount | undefined = signedOut.find((s: SignedOutAccount): boolean =>
    account.cid !== undefined ? s.cid === account.cid : s.username === account.username);
  return match?.reason ?? null;
}
