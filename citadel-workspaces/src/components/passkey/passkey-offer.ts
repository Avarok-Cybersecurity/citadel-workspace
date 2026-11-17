/**
 * What the sign-in form's passkey buttons do, per account on this device.
 *
 * - an option-A passkey: opens its sealed password, then moves to a server key;
 * - a key-first (KeyOnly) account: signs in with the key alone;
 * - an account whose key is a second factor (PasswordAndKey): the key cannot
 *   sign in alone and the server would refuse that, so the button selects the
 *   account and asks for the password; the touch follows it.
 */
import type { SignInHint } from '@/lib/sign-in';
import type { SignInMode } from '../useLoginHandler';
import { passkeyChoices } from './usePasskeyAccounts';

export type PasskeyAction = 'legacy' | 'key-first' | 'password-then-key';

export const PASSWORD_THEN_KEY: string = "Enter your password; you'll then touch your key.";

export function passkeyAction(account: string, legacyAccounts: readonly string[], hints: readonly SignInHint[]): PasskeyAction {
  if (legacyAccounts.includes(account)) return 'legacy';
  return hints.some((hint: SignInHint) => hint.username === account && hint.keyFirst) ? 'key-first' : 'password-then-key';
}

/** The accounts to offer a passkey button for, given what is typed and how the form signs in. */
export function passkeyOffer(
  username: string, mode: SignInMode, hasLegacyKeys: boolean, legacyAccounts: readonly string[], hints: readonly SignInHint[],
): string[] {
  if (mode !== 'password') return [];
  const device: string[] = [...new Set([...legacyAccounts, ...hints.map((hint: SignInHint) => hint.username)])]
    .sort((a: string, b: string) => a.localeCompare(b));
  // The device list counts too, so the offer stays put while the typed name is looked up.
  return passkeyChoices(username, hasLegacyKeys || device.includes(username.trim()), device);
}
