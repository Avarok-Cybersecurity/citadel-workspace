/**
 * What happens after the agent accepts a sign-in, whichever factors it used.
 *
 * - A recovery code opened a restricted session: hand back the account, and
 *   start nothing that would use the workspace.
 * - A key-first sign-in worked: remember the account (tenant + CID) so the
 *   form can offer the key first next time.
 * - An option-A passkey opened the password: offer to move to a key the
 *   server verifies, and on success delete the sealed record. This is the only
 *   thing the old records are still read for.
 * - A password sign-in that asked for it: offer to add a key.
 */
import { warnLog } from '@/lib/debug-config';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import { saveHint, tenantOf } from '@/lib/sign-in';
import type { SignInDeps } from '@/lib/sign-in';
import { SIGN_IN_COPY } from '@/lib/sign-in/copy';
import { legacyRecordFor, retireLegacyRecords } from '@/lib/sign-in/legacy';
import type { AccountRef, SignInFactors } from '@/lib/sign-in/types';
import type { LoginResult } from '../login-with-password';
import type { KeyOfferRequest } from './useKeyOffer';

export interface CompletionDeps {
  login: (username: string, factors: SignInFactors) => Promise<LoginResult>;
  offerKey: (request: KeyOfferRequest) => Promise<boolean>;
  signIn: Pick<SignInDeps, 'store' | 'rpId'>;
}

export type Completed =
  /** keyAdded: whether a key offered after this sign-in was added; null when none was offered. */
  | { kind: 'signed-in'; cid: bigint; messagingReady: boolean; keyAdded: boolean | null }
  | { kind: 'redirected' }
  | { kind: 'recovery'; account: AccountRef };

export const MIGRATE_COPY: { title: string; body: string } = {
  title: 'Move your passkey to the new sign-in',
  body: 'Your passkey used to unlock a password saved on this device. Add it again and the server will ' +
    'check the key itself; the saved password is then deleted.',
};

/** The account a session belongs to, or null when the agent could not say which server it is on. */
function accountOf(username: string, cid: bigint, serverAddress: string): AccountRef | null {
  return serverAddress.trim() ? { tenant: tenantOf(serverAddress), cid, username: username.trim() } : null;
}

export async function completeSignIn(
  deps: CompletionDeps, username: string, factors: SignInFactors, opts: { offerKey: boolean; legacy: boolean },
): Promise<Completed> {
  const result: LoginResult = await deps.login(username, factors);
  if (result.kind === 'redirected') return result;
  const account: AccountRef | null = accountOf(username, result.cid, result.serverAddress);
  if (result.kind === 'recovery') {
    if (!account) throw new Error('Signed in with a recovery code, but the agent did not say which server this account is on');
    return { kind: 'recovery', account };
  }
  const done: Completed = { kind: 'signed-in', cid: result.cid, messagingReady: result.messagingReady, keyAdded: null };
  if (!account) return done;

  if (factors.password === null) {
    try {
      await saveHint(deps.signIn.store, { ...account, keyFirst: true });
    } catch (error) {
      warnLog('SignIn', 'Could not remember this account for key-first sign-in', error);
    }
    return done;
  }
  const stepUp: KeyOfferRequest['stepUp'] = { password: stringToBytes(factors.password), security_key: true };
  if (opts.legacy && await legacyRecordFor(deps.signIn.store, deps.signIn.rpId, account.username, account.cid)) {
    const moved: boolean = await deps.offerKey({ account, stepUp, ...MIGRATE_COPY });
    if (moved) await retireLegacyRecords(deps.signIn.store, deps.signIn.rpId, account.username, account.cid);
    return { ...done, keyAdded: moved };
  } else if (opts.offerKey) {
    const added: boolean = await deps.offerKey({ account, stepUp, title: SIGN_IN_COPY.addKeyTitle, body: SIGN_IN_COPY.addKeyBody });
    return { ...done, keyAdded: added };
  }
  return done;
}
