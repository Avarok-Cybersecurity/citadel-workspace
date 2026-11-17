/**
 * Every sentence the passkey UI says, in one place (docs/plans/passkey-login.md
 * section 3.6). A failure maps to copy by its category only: which step of a
 * ceremony or decrypt failed is not something the UI reveals.
 */
import type { PasskeyFailure } from './authenticator';

export const PASSKEY_COPY: {
  readonly signInButton: 'Use passkey or security key';
  readonly orPassword: 'or use your password';
  readonly enrolSwitch: 'Add a security key after I sign in';
  readonly addButton: 'Add a passkey or security key';
  readonly sectionTitle: 'Sign-in keys';
  readonly pinNote: string;
  readonly unavailableHere: string;
  readonly chooseAccount: 'Sign in with a passkey as:';
  readonly serverUnknown: 'server not recorded on this device';
} = {
  signInButton: 'Use passkey or security key',
  orPassword: 'or use your password',
  enrolSwitch: 'Add a security key after I sign in',
  addButton: 'Add a passkey or security key',
  sectionTitle: 'Sign-in keys',
  pinNote: 'Security keys need a PIN set first — we require it so a lost key can\'t be used on its own.',
  unavailableHere: 'Passkeys need a secure (https or localhost) page in a browser that supports them. Your password still works.',
  chooseAccount: 'Sign in with a passkey as:',
  serverUnknown: 'server not recorded on this device',
} as const;

export const removeCopy = (label: string): string =>
  `Remove ${label}? It will no longer sign you in. ` +
  'It may still appear in your passkey list; you can delete it there too.';

export function failureCopy(failure: PasskeyFailure): string {
  switch (failure) {
    case 'unsupported':
      return "This passkey can't unlock sign-in here (your browser or password manager doesn't support " +
        'the feature we need). Your password still works. Try iCloud Keychain, Google Password Manager, ' +
        'or a YubiKey in Chrome or Firefox.';
    case 'not-set-up-here':
      return "Your passkey works here, but this device doesn't have your sign-in saved yet. " +
        'Enter your password once to set it up.';
    case 'already-enrolled':
      return 'That key is already set up for this account.';
    case 'cancelled':
      return 'The passkey request was cancelled. You can use your password instead.';
    case 'failed':
      return "That didn't work. You can use your password instead.";
  }
}
