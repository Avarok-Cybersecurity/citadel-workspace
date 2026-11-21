/**
 * The recovery console's changes, as SignInManagement requests. A recovery session proves nothing
 * again (the server allows it no step-up and these changes only), so every request carries an
 * empty step-up and offers this window's key for the touch of a key being added.
 */
import { manageSignIn } from '@/lib/sign-in/management';
import type { Send } from '@/lib/sign-in/key-answer';
import { stringToBytes } from '@/lib/utils/encoding-utils';
import type { SignInCredential, SignInManagementOutcome, SignInPolicy, StepUp } from '@/lib/sign-in/types';

/** No password, and a key only to touch a new one: the console's step-up. */
export const RECOVERY_STEP_UP: StepUp = { password: null, security_key: true };

const outcomeError = (what: string): Error => new Error(`The server did not ${what}.`);

export async function setNewPassword(send: Send, cid: bigint, password: string): Promise<void> {
  const outcome: SignInManagementOutcome = await manageSignIn(send, cid, { SetPassword: { new_password: stringToBytes(password) } }, RECOVERY_STEP_UP);
  if (outcome !== 'PasswordSet') throw outcomeError('set the password');
}

export interface ConsoleCredentials {
  policy: SignInPolicy;
  credentials: SignInCredential[];
}

export async function listCredentials(send: Send, cid: bigint): Promise<ConsoleCredentials> {
  const outcome: SignInManagementOutcome = await manageSignIn(send, cid, 'ListCredentials', RECOVERY_STEP_UP);
  if (typeof outcome !== 'object' || !('Credentials' in outcome)) throw outcomeError('list the sign-in methods');
  return { policy: outcome.Credentials.policy, credentials: outcome.Credentials.credentials };
}

export async function removeCredential(send: Send, cid: bigint, id: number): Promise<void> {
  const outcome: SignInManagementOutcome = await manageSignIn(send, cid, { RemoveCredential: { id } }, RECOVERY_STEP_UP);
  if (outcome !== 'Removed') throw outcomeError('remove it');
}

export async function setPolicy(send: Send, cid: bigint, policy: SignInPolicy): Promise<void> {
  const outcome: SignInManagementOutcome = await manageSignIn(send, cid, { SetSignInPolicy: { policy } }, RECOVERY_STEP_UP);
  if (outcome !== 'PolicySet') throw outcomeError('change how you sign in');
}

/** The new phrase's 24 words, to show once. The old phrase stops working at once. */
export async function regeneratePhrase(send: Send, cid: bigint, stepUp: StepUp): Promise<string[]> {
  const outcome: SignInManagementOutcome = await manageSignIn(send, cid, 'RegenerateRecoveryPhrase', stepUp);
  if (typeof outcome !== 'object' || !('RecoveryPhrase' in outcome)) throw outcomeError('make a new recovery phrase');
  return outcome.RecoveryPhrase;
}
