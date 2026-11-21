/**
 * What the sign-in form's passkey buttons do, per account this device remembers.
 *
 * - a key-first (KeyOnly) account: signs in with the key alone;
 * - an account whose key is a second factor (PasswordAndKey): the key cannot
 *   sign in alone and the server would refuse that, so the button selects the
 *   account and asks for the password; the touch follows it.
 */
import type { SignInHint } from '@/lib/sign-in';
import type { SignInMode } from '../useLoginHandler';

export type PasskeyAction = 'key-first' | 'password-then-key';

export const PASSWORD_THEN_KEY: string = "Enter your password; you'll then touch your key.";

export function passkeyAction(account: string, hints: readonly SignInHint[]): PasskeyAction {
  return hints.some((hint: SignInHint) => hint.username === account && hint.keyFirst) ? 'key-first' : 'password-then-key';
}

/**
 * The accounts to offer a passkey button for: the typed one when this device remembers it,
 * or, before anything is typed, every account it remembers. None while the form asks for a key alone.
 */
export function passkeyOffer(username: string, mode: SignInMode, hints: readonly SignInHint[]): string[] {
  if (mode !== 'password') return [];
  const device: string[] = [...new Set(hints.map((hint: SignInHint) => hint.username))]
    .sort((a: string, b: string) => a.localeCompare(b));
  const name: string = username.trim();
  if (name) return device.includes(name) ? [name] : [];
  return device;
}
