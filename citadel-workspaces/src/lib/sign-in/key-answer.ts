/**
 * Answering one security-key challenge: the ceremony it names, for the relying
 * party the server named -- a WebAuthn get() of an allowed key, or for a key
 * being added create() and then get() of the new credential -- with the PRF
 * extension evaluated at the challenge's salt, then the PRF output to the agent.
 *
 * The key's assertion signature is not used and not sent: the agent derives an
 * ML-KEM key from the PRF output and proves it to the server
 * (docs/plans/pq-sign-in.md). A key that returns no PRF output cannot do that,
 * so it is declined here with the reason rather than left to time out.
 */
import { requestResponse } from '@/lib/websocket/request-response';
import { type Assertion, type AuthenticatorPort, PasskeyError } from '@/lib/passkey/authenticator';
import { type Bytes, bytesEqual, copyBytes, randomBytes } from '@/lib/passkey/bytes';
import { registerSecurityKey } from './enrol-key';
import type { SecurityKeyChallengeNotification } from './types';

export const PRF_OUTPUT_BYTES: 32 = 32;
/** The agent answers an answer at once; this bounds a dead socket, not the touch. */
export const KEY_ANSWER_TIMEOUT_MS: 10000 = 10000;

export const NO_PRF_REASON: string =
  "This passkey can't sign you in: its passkey manager didn't provide the PRF output Citadel needs to derive " +
  'your post-quantum sign-in key. Use your password, or a passkey or security key that supports PRF.';
/** A key being added gave no PRF output: what the user is told, and why nothing was added. */
// Checked 2026-10-04: Windows Hello gives PRF only on Windows 11 24H2/25H2 from the February 2026
// update (KB5077181) with Chrome/Edge 147+ or Firefox 148+; hmac-secret security keys work on any
// Windows; iCloud Keychain from macOS 15 / iOS 18.
export const NOT_ADDED_REASON: string =
  "This passkey can't sign you in to Citadel, so it was not added to your account. Citadel derives your " +
  "post-quantum sign-in key from the passkey's PRF feature, and the passkey manager you chose didn't " +
  'provide it. Your password still works. To add a passkey on Windows, use a security key such as a ' +
  'YubiKey 5, or Windows Hello on Windows 11 with the February 2026 update or later and a current ' +
  'Chrome, Edge or Firefox. On a Mac or iPhone, iCloud Keychain works. You can delete the unused ' +
  'passkey from your passkey manager.';
export const CANCELLED_REASON: string = 'The security key request was cancelled.';
export const ALREADY_ENROLLED_REASON: string = 'That key is already set up for this account.';

export type Send = (request: Record<string, unknown>) => Promise<void>;

export interface KeyAnswerDeps {
  authenticator: AuthenticatorPort;
  rpName: string;
  send: Send;
}


export type KeyAnswerResult =
  | { kind: 'answered' }
  /** The window declined: the request it belongs to fails now, with this reason. */
  | { kind: 'declined'; reason: string }
  /** The agent refused the answer; the challenge is still open for another try. */
  | { kind: 'refused'; message: string };

const asBytes = (ids: Uint8Array[]): Bytes[] => ids.map((id: Uint8Array) => copyBytes(id));

/** Fail the asking request now, with the reason, instead of at the touch deadline. */
export async function declineKeyChallenge(deps: Pick<KeyAnswerDeps, 'send'>, challenge: SecurityKeyChallengeNotification, reason: string): Promise<KeyAnswerResult> {
  const requestId: string = crypto.randomUUID();
  await deps.send({ SecurityKeyDecline: { request_id: requestId, challenge_id: challenge.challenge_id, reason } });
  return { kind: 'declined', reason };
}

/** The keys get() may use: the allowed ones, or the one a Register ceremony just made. */
async function allowedKeys(deps: KeyAnswerDeps, challenge: SecurityKeyChallengeNotification): Promise<Bytes[]> {
  const { ceremony } = challenge;
  if ('Authenticate' in ceremony) return asBytes(ceremony.Authenticate.credential_ids);
  const { user_id, user_name, exclude_credential_ids } = ceremony.Register;
  return [await registerSecurityKey(deps, {
    rpId: challenge.rp_id, userId: user_id, userName: user_name, excludeCredentialIds: exclude_credential_ids,
  })];
}

async function touch(deps: KeyAnswerDeps, challenge: SecurityKeyChallengeNotification): Promise<Assertion | string> {
  const salt: Bytes = copyBytes(Uint8Array.from(challenge.prf_salt));
  const noPrf: string = 'Register' in challenge.ceremony ? NOT_ADDED_REASON : NO_PRF_REASON;
  try {
    const allowed: Bytes[] = await allowedKeys(deps, challenge);
    if (allowed.length === 0) return noPrf;
    const assertion: Assertion = await deps.authenticator.get({
      rpId: challenge.rp_id,
      // Not verified by anyone: the classical assertion is not part of the proof.
      challenge: randomBytes(32),
      allow: allowed.map((id: Bytes) => ({ id, transports: [], prfSalt: salt })),
    });
    if (!allowed.some((id: Bytes) => bytesEqual(id, assertion.credentialId))) return CANCELLED_REASON;
    if (!assertion.prfFirst || assertion.prfFirst.byteLength !== PRF_OUTPUT_BYTES) return noPrf;
    return assertion;
  } catch (error) {
    if (error instanceof PasskeyError && error.failure === 'unsupported') return noPrf;
    if (error instanceof PasskeyError && error.failure === 'already-enrolled') return ALREADY_ENROLLED_REASON;
    return CANCELLED_REASON;
  }
}

export async function answerKeyChallenge(
  deps: KeyAnswerDeps, challenge: SecurityKeyChallengeNotification,
): Promise<KeyAnswerResult> {
  const touched: Assertion | string = await touch(deps, challenge);
  if (typeof touched === 'string') return declineKeyChallenge(deps, challenge, touched);

  const requestId: string = crypto.randomUUID();
  const prf: Uint8Array = touched.prfFirst as Bytes;
  try {
    // Resolves true on SecurityKeyAnswerSuccess; a SecurityKeyAnswerFailure rejects, and lands below.
    const accepted: boolean = await requestResponse<true>({
      request: {
        SecurityKeyAnswer: {
          request_id: requestId, challenge_id: challenge.challenge_id,
          credential_id: touched.credentialId, prf_output: prf,
        },
      },
      requestId,
      sendRequest: (request: unknown): Promise<void> => deps.send(request as Record<string, unknown>),
      timeoutMs: KEY_ANSWER_TIMEOUT_MS,
      operationName: 'Security key answer',
      matcher: {
        matchSuccess: (m: Record<string, unknown>): true | undefined =>
          (m.SecurityKeyAnswerSuccess as { request_id?: unknown } | undefined)?.request_id === requestId ? true : undefined,
        matchFailure: (m: Record<string, unknown>): string | undefined => {
          const failure: { request_id?: unknown; message?: unknown } | undefined =
            m.SecurityKeyAnswerFailure as { request_id?: unknown; message?: unknown } | undefined;
          return failure?.request_id === requestId ? String(failure.message) : undefined;
        },
      },
    });
    return accepted ? { kind: 'answered' } : { kind: 'refused', message: 'The agent did not accept the answer' };
  } catch (error) {
    return { kind: 'refused', message: error instanceof Error ? error.message : String(error) };
  } finally {
    prf.fill(0);
    (touched.prfFirst as Bytes).fill(0);
  }
}
