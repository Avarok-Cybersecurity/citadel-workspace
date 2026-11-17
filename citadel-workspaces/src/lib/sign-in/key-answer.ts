/**
 * Answering one security-key challenge: a WebAuthn get() with the PRF
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
import type { SecurityKeyChallengeNotification } from './types';

export const PRF_OUTPUT_BYTES: 32 = 32;
/** The agent answers an answer at once; this bounds a dead socket, not the touch. */
export const KEY_ANSWER_TIMEOUT_MS: 10000 = 10000;

export const NO_PRF_REASON: string =
  "This passkey can't sign you in: its passkey manager didn't provide the PRF output Citadel needs to derive " +
  'your post-quantum sign-in key. Use your password, or a passkey or security key that supports PRF.';
export const CANCELLED_REASON: string = 'The security key request was cancelled.';

export type Send = (request: Record<string, unknown>) => Promise<void>;

export interface KeyAnswerDeps {
  authenticator: AuthenticatorPort;
  rpId: string;
  send: Send;
}

export type KeyAnswerResult =
  | { kind: 'answered' }
  /** The window declined: the request it belongs to fails now, with this reason. */
  | { kind: 'declined'; reason: string }
  /** The agent refused the answer; the challenge is still open for another try. */
  | { kind: 'refused'; message: string };

const asBytes = (ids: number[][]): Bytes[] => ids.map((id) => copyBytes(Uint8Array.from(id)));

/** Fail the asking request now, with the reason, instead of at the touch deadline. */
export async function declineKeyChallenge(deps: Pick<KeyAnswerDeps, 'send'>, challenge: SecurityKeyChallengeNotification, reason: string): Promise<KeyAnswerResult> {
  const requestId: string = crypto.randomUUID();
  await deps.send({ SecurityKeyDecline: { request_id: requestId, challenge_id: challenge.challenge_id, reason } });
  return { kind: 'declined', reason };
}

async function touch(deps: KeyAnswerDeps, challenge: SecurityKeyChallengeNotification): Promise<Assertion | string> {
  const allowed: Bytes[] = asBytes(challenge.allowed_credential_ids);
  if (allowed.length === 0) return NO_PRF_REASON;
  const salt: Bytes = copyBytes(Uint8Array.from(challenge.prf_salt));
  try {
    const assertion: Assertion = await deps.authenticator.get({
      rpId: deps.rpId,
      // Not verified by anyone: the classical assertion is not part of the proof.
      challenge: randomBytes(32),
      allow: allowed.map((id: Bytes) => ({ id, transports: [], prfSalt: salt })),
    });
    if (!allowed.some((id: Bytes) => bytesEqual(id, assertion.credentialId))) return CANCELLED_REASON;
    if (!assertion.prfFirst || assertion.prfFirst.byteLength !== PRF_OUTPUT_BYTES) return NO_PRF_REASON;
    return assertion;
  } catch (error) {
    if (error instanceof PasskeyError && error.failure === 'unsupported') return NO_PRF_REASON;
    return CANCELLED_REASON;
  }
}

export async function answerKeyChallenge(
  deps: KeyAnswerDeps, challenge: SecurityKeyChallengeNotification,
): Promise<KeyAnswerResult> {
  const touched: Assertion | string = await touch(deps, challenge);
  if (typeof touched === 'string') return declineKeyChallenge(deps, challenge, touched);

  const requestId: string = crypto.randomUUID();
  const prf: number[] = Array.from(touched.prfFirst as Bytes);
  try {
    // Resolves true on SecurityKeyAnswerSuccess; a SecurityKeyAnswerFailure rejects, and lands below.
    const accepted: boolean = await requestResponse<true>({
      request: {
        SecurityKeyAnswer: {
          request_id: requestId, challenge_id: challenge.challenge_id,
          credential_id: Array.from(touched.credentialId), prf_output: prf,
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
