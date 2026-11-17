/**
 * The authenticator port: the one I/O boundary between the passkey logic and
 * `navigator.credentials`.
 *
 * It speaks in what the logic needs (credential id, PRF output, public key),
 * not in `PublicKeyCredential`, so a test can stand in for a Touch ID prompt
 * or a YubiKey without faking the browser's object graph. The production
 * adapter is browser-authenticator.ts.
 */
import type { Bytes } from './bytes';

export interface CreateCeremony {
  rpId: string;
  rpName: string;
  userHandle: Bytes;
  userName: string;
  userDisplayName: string;
  challenge: Bytes;
  excludeCredentialIds: Bytes[];
  prfSalt: Bytes;
}

export interface CreatedCredential {
  credentialId: Bytes;
  transports: string[];
  publicKeySpki: Bytes | null;
  publicKeyAlgorithm: number;
  attestationObject: Bytes;
  /** `enabled` is what create() reported; `first` is the PRF output, if any. */
  prf: { enabled: boolean | undefined; first: Bytes | null };
}

export interface AllowedCredential {
  id: Bytes;
  transports: string[];
  prfSalt: Bytes;
}

export interface GetCeremony {
  rpId: string;
  challenge: Bytes;
  allow: AllowedCredential[];
}

export interface Assertion {
  credentialId: Bytes;
  prfFirst: Bytes | null;
}

export interface AuthenticatorPort {
  create(ceremony: CreateCeremony): Promise<CreatedCredential>;
  get(ceremony: GetCeremony): Promise<Assertion>;
  /** Best effort: asks the passkey provider to forget a credential we will not use. */
  signalUnknownCredential(rpId: string, credentialId: Bytes): Promise<void>;
  /**
   * True only when the browser itself says it has no PRF, so no key made here
   * could ever sign in. False means "ask the ceremony": a browser that reports
   * PRF can still hand the request to a provider that returns none.
   */
  prfRuledOut(): Promise<boolean>;
}

/**
 * What went wrong, at the granularity the UI copy distinguishes and no finer.
 * A tampered record and a wrong key are both `not-set-up-here`.
 */
export type PasskeyFailure = 'cancelled' | 'unsupported' | 'not-set-up-here' | 'already-enrolled' | 'failed';

export class PasskeyError extends Error {
  readonly failure: PasskeyFailure;
  constructor(failure: PasskeyFailure) {
    super(`Passkey operation did not complete (${failure})`);
    this.name = 'PasskeyError';
    this.failure = failure;
  }
}

export function failureOf(error: unknown): PasskeyFailure {
  return error instanceof PasskeyError ? error.failure : 'failed';
}
