/**
 * The agent's answer to one Connect, by request id.
 *
 * Registered BEFORE the Connect is sent, so an answer cannot arrive unheard.
 * Three answers settle it; anything else on the socket is someone else's.
 *
 * Lifted out of `useLoginHandler`, where it was inline, because the settings
 * page needs the same question answered: "is this the account's password?" --
 * the agent checks it against the live session and answers SessionAlreadyActive
 * or ConnectFailure.
 */
import { isResponseType, type InternalServiceResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import { extensionFor } from '@/lib/sign-in/challenge-watch';
import type { FailureReason } from 'citadel-workspace-client-ts';
import { admissionChallengeOf, type AdmissionChallenge } from '@/lib/admission/refusal';

export type ConnectOutcome =
  | { kind: 'connected'; cid: bigint }
  | { kind: 'already-active'; cid: bigint; username: string; message: string }
  /**
   * reasonCode: why, when the refusal says: the server's admission refusal (a human check was
   * required or failed) or the agent's wrong-server refusal; challenge: the check it published to
   * show (refusal.ts admissionChallengeOf).
   */
  | { kind: 'failed'; cid: bigint; message: string; reasonCode: FailureReason | null; challenge: AdmissionChallenge | null };

/**
 * A sign-in that asks for a security key answers only after the touch, so a
 * challenge for this Connect restarts the wait at the touch window plus the
 * ordinary budget: the user is never told "timeout" while holding the key.
 */
export function awaitConnectOutcome(requestId: string, timeoutMs: number): Promise<ConnectOutcome> {
  return new Promise<ConnectOutcome>((resolve, reject) => {
    const arm = (ms: number): ReturnType<typeof setTimeout> => setTimeout((): void => {
      eventEmitter.off('websocket-message', handler);
      reject(new Error('Connection timeout'));
    }, ms);
    const settle = (outcome: ConnectOutcome): void => {
      clearTimeout(timeout);
      eventEmitter.off('websocket-message', handler);
      resolve(outcome);
    };
    const handler = (message: InternalServiceResponse): void => {
      const response: InternalServiceResponse = (message as Record<string, unknown>).Response
        ? ((message as Record<string, unknown>).Response as InternalServiceResponse) : message;
      const extension: number | null = extensionFor(response, requestId, timeoutMs);
      if (extension !== null) {
        clearTimeout(timeout);
        timeout = arm(extension);
        return;
      }
      if (isResponseType(response, 'ConnectSuccess') && response.ConnectSuccess.request_id === requestId) {
        settle({ kind: 'connected', cid: response.ConnectSuccess.cid });
      } else if (isResponseType(response, 'SessionAlreadyActive') && response.SessionAlreadyActive.request_id === requestId) {
        const { cid, username, message: msg } = response.SessionAlreadyActive;
        settle({ kind: 'already-active', cid: cid as bigint, username: username ?? '', message: msg ?? '' });
      } else if (isResponseType(response, 'ConnectFailure') && response.ConnectFailure.request_id === requestId) {
        settle({
          kind: 'failed', cid: response.ConnectFailure.cid, message: response.ConnectFailure.message || 'Connection failed',
          reasonCode: response.ConnectFailure.reason_code ?? null,
          challenge: admissionChallengeOf(response.ConnectFailure as unknown as Record<string, unknown>),
        });
      }
    };
    let timeout: ReturnType<typeof setTimeout> = arm(timeoutMs);
    eventEmitter.on('websocket-message', handler);
  });
}
