/**
 * Every sentence the post-quantum sign-in UI says, in one place, beside the
 * passkey copy it extends (lib/passkey/copy.ts).
 */
import { PasskeyError } from '@/lib/passkey/authenticator';
import { describeFailure } from '@/lib/failure-message';
import { CANCELLED_REASON } from './key-answer';
import { SignInManagementError } from './management';
import type { SecurityKeyPurpose, SignInPolicy } from './types';

export const SIGN_IN_COPY: {
  readonly continueWithKey: 'Continue';
  readonly waitingForKey: 'Waiting for your key…';
  readonly touchHint: string;
  readonly useKeyInstead: 'Sign in with a security key instead';
  readonly usePasswordInstead: 'Use my password instead';
  readonly lostKey: 'Lost your key?';
  readonly recoveryLabel: 'Recovery code';
  readonly recoveryHint: string;
  readonly recoverySubmit: 'Sign in with recovery code';
  readonly recoveryTitle: 'Signed in with a recovery code';
  readonly recoveryBody: string;
  readonly codesTitle: 'Save your recovery codes';
  readonly codesBody: string;
  readonly codesSaved: "I've saved these codes";
  readonly addKeyTitle: 'Add a security key';
  readonly addKeyBody: string;
  readonly stepUpTitle: "Confirm it's you";
  readonly stepUpBody: string;
  readonly policyTitle: 'How you sign in';
  readonly regenerate: 'New recovery codes';
  readonly showKeys: 'Show my sign-in keys';
  readonly regenerateWarning: string;
} = {
  continueWithKey: 'Continue',
  waitingForKey: 'Waiting for your key…',
  touchHint: 'Press Continue, then touch your security key or use Touch ID when your browser asks.',
  useKeyInstead: 'Sign in with a security key instead',
  usePasswordInstead: 'Use my password instead',
  lostKey: 'Lost your key?',
  recoveryLabel: 'Recovery code',
  recoveryHint: 'One of the codes you saved when you created your account. Each works once.',
  recoverySubmit: 'Sign in with recovery code',
  recoveryTitle: 'Signed in with a recovery code',
  recoveryBody:
    'This session can only add a security key and choose how you sign in. ' +
    'Add a key now, then sign out and sign in with it.',
  codesTitle: 'Save your recovery codes',
  codesBody:
    "If you lose every security key, a recovery code is the only way back in. Each code works once. " +
    "Keep them somewhere safe: they won't be shown again.",
  codesSaved: "I've saved these codes",
  addKeyTitle: 'Add a security key',
  addKeyBody:
    'Sign in with Touch ID, your phone or a security key. The server checks the key itself, ' +
    'with post-quantum cryptography, and your password never leaves this device.',
  stepUpTitle: "Confirm it's you",
  stepUpBody: 'Changes to how you sign in need your password or one of your security keys.',
  policyTitle: 'How you sign in',
  regenerate: 'New recovery codes',
  showKeys: 'Show my sign-in keys',
  regenerateWarning: 'Your current recovery codes will stop working.',
} as const;

/**
 * Why a passkey cannot be used, and what to do instead. Sign-in derives the
 * account's post-quantum key from the WebAuthn PRF output, so a passkey whose
 * manager gives none can never sign in; it is refused, never enrolled.
 */
export const PRF_COPY: { readonly notAdded: string; readonly unavailableHere: string } = {
  // Checked 2026-10-04: Windows Hello gives PRF only on Windows 11 24H2/25H2 from the February 2026
  // update (KB5077181) with Chrome/Edge 147+ or Firefox 148+; hmac-secret security keys work on any
  // Windows; iCloud Keychain from macOS 15 / iOS 18.
  notAdded:
    "This passkey can't sign you in to Citadel, so it was not added to your account. Citadel derives your " +
    "post-quantum sign-in key from the passkey's PRF feature, and the passkey manager you chose didn't " +
    'provide it. Your password still works. To add a passkey on Windows, use a security key such as a ' +
    'YubiKey 5, or Windows Hello on Windows 11 with the February 2026 update or later and a current ' +
    'Chrome, Edge or Firefox. On a Mac or iPhone, iCloud Keychain works. You can delete the unused ' +
    'passkey from your passkey manager.',
  unavailableHere:
    "This browser can't make a passkey that signs in to Citadel: it doesn't support the PRF feature Citadel " +
    'uses to derive your post-quantum sign-in key. Your password still works. To add a passkey, open ' +
    'Citadel in a current Chrome, Edge, Firefox or Safari.',
} as const;

export function challengeTitle(purpose: SecurityKeyPurpose): string {
  switch (purpose) {
    case 'SignIn': return 'Touch your security key';
    case 'StepUp': return "Confirm it's you with your security key";
    case 'Enrol': return 'Touch your new security key';
  }
}

export const POLICY_COPY: Record<SignInPolicy, { label: string; detail: string }> = {
  Password: { label: 'Password', detail: 'Your password alone signs you in.' },
  PasswordAndKey: { label: 'Password and security key', detail: 'Your password, then a touch of one of your keys.' },
  KeyOnly: { label: 'Security key only', detail: 'A touch of one of your keys, and no password.' },
};

export const secondsLeftCopy = (seconds: number): string =>
  seconds === 1 ? '1 second left' : `${seconds} seconds left`;

/** What to tell the user when adding or using a key failed: the server's own words when it refused. */
export function keyFailureCopy(error: unknown): string {
  if (error instanceof PasskeyError) {
    if (error.failure === 'unsupported') return PRF_COPY.notAdded;
    if (error.failure === 'cancelled') return CANCELLED_REASON;
    if (error.failure === 'already-enrolled') return 'That key is already set up for this account.';
  }
  if (error instanceof SignInManagementError) return error.message;
  return describeFailure(error, "That didn't work. Try again.");
}
