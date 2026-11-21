/**
 * What happens after the agent accepts a sign-in, whichever factors it used.
 *
 * - A key-first sign-in worked: remember the account (tenant + CID) so the
 *   form can offer the key first next time.
 * - A password sign-in that asked for it: offer to add a key.
 */
import { warnLog } from '@/lib/debug-config';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import { saveHint, tenantOf } from '@/lib/sign-in';
import type { SignInDeps } from '@/lib/sign-in';
import { SIGN_IN_COPY } from '@/lib/sign-in/copy';
import type { AccountRef, SignInFactors } from '@/lib/sign-in/types';
import type { LoginResult } from '../login-with-password';
import type { KeyOfferRequest } from './useKeyOffer';

export interface CompletionDeps {
  login: (username: string, factors: SignInFactors) => Promise<LoginResult>;
  offerKey: (request: KeyOfferRequest) => Promise<boolean>;
  signIn: Pick<SignInDeps, 'store'>;
}

export type Completed =
  /** keyAdded: whether a key offered after this sign-in was added; null when none was offered. */
  | { kind: 'signed-in'; cid: bigint; messagingReady: boolean; keyAdded: boolean | null }
  | { kind: 'redirected' };

/** The account a session belongs to, or null when the agent could not say which server it is on. */
function accountOf(username: string, cid: bigint, serverAddress: string): AccountRef | null {
  return serverAddress.trim() ? { tenant: tenantOf(serverAddress), cid, username: username.trim() } : null;
}

export async function completeSignIn(
  deps: CompletionDeps, username: string, factors: SignInFactors, opts: { offerKey: boolean },
): Promise<Completed> {
  const result: LoginResult = await deps.login(username, factors);
  if (result.kind === 'redirected') return result;
  const account: AccountRef | null = accountOf(username, result.cid, result.serverAddress);
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
  if (opts.offerKey) {
    const added: boolean = await deps.offerKey({ account, stepUp, title: SIGN_IN_COPY.addKeyTitle, body: SIGN_IN_COPY.addKeyBody });
    return { ...done, keyAdded: added };
  }
  return done;
}
