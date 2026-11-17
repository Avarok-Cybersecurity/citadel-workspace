import type { CallState } from './call-state';
import type { CallParticipant } from '@/lib/call/call-state';

/**
 * What to tell the caller about a call that never connected.
 *
 * The reducer records a reason on every terminal state, and `CallState.reason`
 * is documented as being there "for the UI to explain itself" — but both call
 * surfaces hide the `ended` status, so every outcome presented identically: the
 * outgoing panel silently vanished with a down-chime. Declined, busy, no
 * microphone and forty-five seconds unanswered were indistinguishable.
 *
 * `no-devices` is the case that makes this matter: the callee's client sends it
 * precisely so the caller knows to try another way, and it was the outcome most
 * likely to be read as "they ignored me".
 *
 * Returns null when there is nothing worth saying — a normal hangup, or a
 * reason this build does not recognise. Silence is better than a toast that
 * says "the call ended because it ended".
 */
export function callOutcomeMessage(reason: string | null, peerName: string): string | null {
  switch (reason) {
    case 'rejected':
      return `${peerName} declined the call.`;
    case 'busy':
      return `${peerName} is already on another call.`;
    case 'no-devices':
      return `${peerName} has no working microphone or camera.`;
    case 'unsupported':
      return `${peerName}'s browser cannot take calls.`;
    case 'unanswered':
      return `${peerName} did not answer.`;
    case 'timeout':
      return 'The call timed out before it connected.';
    case 'error':
      return 'The call ended because of an error.';
    default:
      return null;
  }
}

/**
 * The name to use in that sentence. Falls back to a generic noun rather than a
 * raw CID: a number is worse than no name at all, and this campaign has already
 * recorded CIDs leaking into the UI as identity.
 */
export function callOutcomePeerName(call: CallState): string {
  const named: CallParticipant | undefined = [...call.participants.values()].find((p): string => p.username);
  return named?.username ?? 'They';
}
