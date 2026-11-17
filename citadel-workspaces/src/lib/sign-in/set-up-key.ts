/**
 * Adding a key and choosing how it is used, as one step: a key under the
 * Password policy is never asked for at sign-in, so the choice is made with it.
 *
 * Used after registration, after a sign-in that offered it, after an option-A
 * passkey sign-in (to move off the sealed password), and in a recovery session.
 */
import { warnLog } from '@/lib/debug-config';
import { addSecurityKey } from './enrol-key';
import { saveHint } from './hints';
import { manageSignIn } from './management';
import type { SignInDeps } from './index';
import type { AccountRef, SignInPolicy, StepUp } from './types';

export type KeyPolicy = Exclude<SignInPolicy, 'Password'>;

export interface KeySetUp {
  account: AccountRef;
  label: string;
  /** How the account signs in once the key is added. */
  policy: KeyPolicy;
  stepUp: StepUp;
  existingCredentialIds: number[][];
}

export async function setUpSecurityKey(deps: SignInDeps, req: KeySetUp): Promise<void> {
  await addSecurityKey(deps, { account: req.account, label: req.label, existingCredentialIds: req.existingCredentialIds }, req.stepUp);
  await manageSignIn(deps.send, req.account.cid, { SetSignInPolicy: { policy: req.policy } }, { ...req.stepUp, security_key: true });
  try {
    await saveHint(deps.store, { ...req.account, keyFirst: req.policy === 'KeyOnly' });
  } catch (error) {
    // The key is enrolled and the policy set on the server; the hint only saves typing.
    warnLog('SignIn', 'Could not remember this account for key-first sign-in', error);
  }
}
