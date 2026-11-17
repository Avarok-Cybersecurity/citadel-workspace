/**
 * The welcome notification, shown to an account once.
 *
 * It was added on every connection change, with nothing recording that it had
 * been shown, into a notification store that lives only in memory -- so every
 * page load and every sign-out and sign-in greeted the account again.
 *
 * The record lives in the agent's LocalDB under the ACCOUNT's cid: a cid is
 * permanent per account, and the agent keeps an account's LocalDB across
 * sign-out (requests/peer/disconnect.rs leaves it alone). Browser storage would
 * not do: it is per browser profile, and sign-out is where browsers get cleared.
 *
 * A read that FAILED is not "not yet welcomed": it is rethrown, and nothing is
 * shown. Treating a timeout as absence is how a greeting turns into a nag.
 */
import { isGenuinelyAbsent } from '@/lib/storage/absence';
import type { LocalDbGet } from '@/lib/live-document-store/stored-reads';

export const WELCOME_TITLE: string = 'Welcome to Citadel Workspaces';
export const WELCOME_BODY: string = 'Your secure workspace is ready. Explore the features and connect with your team.';

/** Not under `app:` or `agent:`, which the agent reserves (requests/local_db/mod.rs). */
export const WELCOMED_KEY: string = 'welcome_shown';

export interface WelcomeLedger extends LocalDbGet {
  sendLocalDBSet(cid: bigint, key: string, value: number[]): Promise<void>;
}

async function hasBeenWelcomed(ledger: WelcomeLedger, cid: bigint): Promise<boolean> {
  try {
    return (await ledger.sendLocalDBGet(cid, WELCOMED_KEY)) !== null;
  } catch (error: unknown) {
    if (isGenuinelyAbsent(error)) return false;
    throw error;
  }
}

/**
 * Greet `cid` unless it has been greeted before. Recorded before greeting, so a
 * record that cannot be written shows nothing rather than a greeting that will
 * come back. Resolves true when it greeted.
 */
export async function welcomeOnce(ledger: WelcomeLedger, cid: bigint, greet: () => void): Promise<boolean> {
  if (await hasBeenWelcomed(ledger, cid)) return false;
  await ledger.sendLocalDBSet(cid, WELCOMED_KEY, [1]);
  greet();
  return true;
}
