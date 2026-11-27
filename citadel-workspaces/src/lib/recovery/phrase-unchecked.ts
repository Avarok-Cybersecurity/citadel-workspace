/**
 * Whether an account's recovery phrase was shown but its check skipped. Only that fact is kept,
 * never a word: the phrase lives on screen and nowhere else, so a skipped check cannot be done
 * later and the remedy is a new phrase. Kept in this browser's keyValue store, keyed by tenant
 * and CID as the sign-in hints are, so `alice` on two tenants is two accounts.
 */
import { dbDelete, dbGet, dbPut } from '@/lib/storage-utils';
import type { AccountRef } from '@/lib/sign-in/types';

export type PhraseAccount = Pick<AccountRef, 'tenant' | 'cid'>;

const keyOf = (account: PhraseAccount): string =>
  `recovery-phrase-unchecked/${encodeURIComponent(account.tenant)}/${account.cid.toString()}`;

/** A phrase step just finished: a skipped check marks the account, a passed one clears any mark. */
export async function recordPhraseCheck(account: PhraseAccount, checked: boolean): Promise<void> {
  if (checked) await dbDelete('keyValue', keyOf(account));
  else await dbPut('keyValue', keyOf(account), true);
}

export async function isPhraseUnchecked(account: PhraseAccount): Promise<boolean> {
  return (await dbGet<unknown>('keyValue', keyOf(account))) === true;
}
