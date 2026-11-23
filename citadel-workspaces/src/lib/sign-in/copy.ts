/**
 * Every sentence the post-quantum sign-in UI says, in one place, beside the
 * passkey copy it extends (lib/passkey/copy.ts).
 */
import { PasskeyError } from '@/lib/passkey/authenticator';
import { describeFailure } from '@/lib/failure-message';
import { ALREADY_ENROLLED_REASON, CANCELLED_REASON, NOT_ADDED_REASON } from './key-answer';
import { SignInManagementError } from './management';
import type { SecurityKeyPurpose, SignInPolicy } from './types';

export const SIGN_IN_COPY: {
  readonly continueWithKey: 'Continue';
  readonly waitingForKey: 'Waiting for your key…';
  readonly touchHint: string;
  readonly useKeyInstead: 'Sign in with a security key instead';
  readonly usePasswordInstead: 'Use my password instead';
  readonly addKeyTitle: 'Add a security key';
  readonly addKeyBody: string;
  readonly stepUpTitle: "Confirm it's you";
  readonly stepUpBody: string;
  readonly policyTitle: 'How you sign in';
  readonly showKeys: 'Show my sign-in keys';
} = {
  continueWithKey: 'Continue',
  waitingForKey: 'Waiting for your key…',
  touchHint: 'Press Continue, then touch your security key or use Touch ID when your browser asks.',
  useKeyInstead: 'Sign in with a security key instead',
  usePasswordInstead: 'Use my password instead',
  addKeyTitle: 'Add a security key',
  addKeyBody:
    'Sign in with Touch ID, your phone or a security key. The server checks the key itself, ' +
    'with post-quantum cryptography, and your password never leaves this device.',
  stepUpTitle: "Confirm it's you",
  stepUpBody: 'Changes to how you sign in need your password or one of your security keys.',
  policyTitle: 'How you sign in',
  showKeys: 'Show my sign-in keys',
} as const;

/**
 * Why a passkey cannot be used, and what to do instead. Sign-in derives the
 * account's post-quantum key from the WebAuthn PRF output, so a passkey whose
 * manager gives none can never sign in; it is refused, never enrolled.
 */
export const PRF_COPY: { readonly notAdded: string; readonly unavailableHere: string } = {
  // Kept in key-answer.ts: a key being added declines its Enrol challenge with it.
  notAdded: NOT_ADDED_REASON,
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

/**
 * Said where a policy that asks for a key is chosen. The agent brings a dropped session back
 * with the password alone; a key needs a touch it cannot make, so such a session signs in again.
 */
export const KEY_POLICY_RECONNECT_NOTE: string =
  "If your connection to the workspace drops, Citadel can't touch your key for you, so it will ask you to sign in again.";

/** Whether signing in under `policy` needs a key touch. */
export const asksForKey = (policy: SignInPolicy): boolean => policy !== 'Password';

export const secondsLeftCopy = (seconds: number): string =>
  seconds === 1 ? '1 second left' : `${seconds} seconds left`;

/** The agent's SDK refused to ask this server for a key: the server has not enabled security keys. */
export const SERVER_CANNOT_ENROL_KEYS: string =
  "This workspace server hasn't enabled security keys, so you can't add one here. Your password still works.";

/** What to tell the user when adding or using a key failed: the server's own words when it refused. */
export function keyFailureCopy(error: unknown): string {
  if (error instanceof PasskeyError) {
    if (error.failure === 'unsupported') return PRF_COPY.notAdded;
    if (error.failure === 'cancelled') return CANCELLED_REASON;
    if (error.failure === 'already-enrolled') return ALREADY_ENROLLED_REASON;
  }
  if (error instanceof SignInManagementError) {
    if (error.reason === 'server_cannot_enrol_security_keys') return SERVER_CANNOT_ENROL_KEYS;
    return error.message;
  }
  return describeFailure(error, "That didn't work. Try again.");
}
