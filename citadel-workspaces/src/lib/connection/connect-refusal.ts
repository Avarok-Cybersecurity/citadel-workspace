/**
 * A refused Connect as the error the sign-in forms act on: the agent's wrong-server
 * refusal (sign-in-server.ts), the server's admission refusal (shown on the check),
 * a reason newer than this page (reload it), or the plain message.
 */
import { AdmissionRefusal, admissionReasonOf, type AdmissionReason } from '@/lib/admission/refusal';
import { signInServerReasonOf, SignInServerRefusal, type SignInServerReason } from '@/lib/sessions/sign-in-server';
import type { ConnectOutcome } from './await-connect-outcome';

/** A reason code newer than this page (FailureReason `unknown`): only the current page can act on it. */
export const UNKNOWN_REASON_COPY: string =
  'This page is older than the Citadel agent on this computer and cannot act on its answer. Reload the page to update it.';

export function connectRefusal(outcome: Extract<ConnectOutcome, { kind: 'failed' }>, username: string): Error {
  if (outcome.reasonCode === 'unknown') return new Error(UNKNOWN_REASON_COPY);
  const wrongServer: SignInServerReason | null = signInServerReasonOf(outcome.reasonCode);
  if (wrongServer !== null) return new SignInServerRefusal(wrongServer, username);
  const admission: AdmissionReason | null = admissionReasonOf({ reason_code: outcome.reasonCode });
  return admission !== null ? new AdmissionRefusal(admission, outcome.message, outcome.challenge) : new Error(outcome.message);
}
