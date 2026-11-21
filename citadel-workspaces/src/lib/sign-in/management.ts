/**
 * One SignInManagement request: a change to the account's sign-in factors,
 * carried out by the server with a fresh step-up proof.
 *
 * The request may cause key challenges (the step-up's touch, or the touch of a
 * key being added). They are watched for the request's lifetime so the prompt
 * shows them, and each one extends the wait by its touch window: the agent
 * answers only once the server has decided, which can be a minute after a
 * request that needed a touch.
 */
import { onSocketLost } from '../websocket/socket-loss';
import { eventEmitter } from '@/lib/event-emitter';
import { extensionFor, watchKeyChallenges } from './challenge-watch';
import type { Send } from './key-answer';
import type { FailureReason, SignInManagementFailure, SignInManagementSuccess } from 'citadel-workspace-client-ts';
import type { SignInManagementOp, SignInManagementOutcome, StepUp } from './types';

/** The server's own round trip, before any touch extends it. */
export const MANAGEMENT_TIMEOUT_MS: 30000 = 30000;

export class SignInManagementError extends Error {
  /** What the agent said the UI can act on (SignInManagementFailure.reason), or null. */
  readonly reason: FailureReason | null;
  constructor(message: string, reason: FailureReason | null) {
    super(message);
    this.name = 'SignInManagementError';
    this.reason = reason;
  }
}

/** Either answer, as it arrives and before it is read: every field of both, each unknown. */
type Answer = Partial<Record<keyof SignInManagementSuccess | keyof SignInManagementFailure, unknown>>;

/** A Rust `None` arrives as an absent field (wasm-none-is-undefined); either reads as no reason. */
const reasonOf = (failure: Answer): FailureReason | null =>
  typeof failure.reason === 'string' ? (failure.reason as FailureReason) : null;

function answerOf(message: unknown, variant: string, requestId: string): Answer | null {
  if (!message || typeof message !== 'object') return null;
  const value: unknown = (message as Record<string, unknown>)[variant];
  if (!value || typeof value !== 'object') return null;
  return (value as Answer).request_id === requestId ? (value as Answer) : null;
}

export function manageSignIn(
  send: Send, cid: bigint, op: SignInManagementOp, stepUp: StepUp,
): Promise<SignInManagementOutcome> {
  const requestId: string = crypto.randomUUID();
  const unwatch: () => void = watchKeyChallenges(requestId);
  return new Promise<SignInManagementOutcome>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (): void => {
      clearTimeout(timer);
      eventEmitter.off('websocket-message', onMessage);
      stopListeningForLoss();
      unwatch();
    };
    const arm = (ms: number): void => {
      clearTimeout(timer);
      timer = setTimeout((): void => { finish(); reject(new SignInManagementError('The agent did not answer in time.', null)); }, ms);
    };
    const onDisconnected = (): void => {
      finish();
      reject(new SignInManagementError('The connection to the Citadel agent was lost.', null));
    };
    const onMessage = (message: unknown): void => {
      const extension: number | null = extensionFor(message, requestId, MANAGEMENT_TIMEOUT_MS);
      if (extension !== null) { arm(extension); return; }
      const success: Answer | null = answerOf(message, 'SignInManagementSuccess', requestId);
      if (success) { finish(); resolve(success.outcome as SignInManagementOutcome); return; }
      const failure: Answer | null = answerOf(message, 'SignInManagementFailure', requestId);
      if (failure) { finish(); reject(new SignInManagementError(String(failure.message), reasonOf(failure))); }
    };
    eventEmitter.on('websocket-message', onMessage);
    const stopListeningForLoss: () => void = onSocketLost(onDisconnected);
    arm(MANAGEMENT_TIMEOUT_MS);
    send({ SignInManagement: { request_id: requestId, cid, op, step_up: stepUp } }).catch((error: unknown): void => {
      finish();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
