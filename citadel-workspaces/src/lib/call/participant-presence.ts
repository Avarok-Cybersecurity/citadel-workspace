/**
 * Who is still in this call, and who has actually answered.
 *
 * `status !== 'left' && status !== 'declined'` was written out SEVEN times --
 * the stage, the ongoing-call bar, the reducer, the signal handler, the call
 * manager, the group-call entry and the state module -- in two different
 * orders. Seven places for one predicate to drift, and the comment on the bar
 * ("Filtered the same way the stage filters, so the count the bar reports and
 * the tiles the user would see on Return agree") says out loud that they have
 * to match and does not make them.
 *
 * `stillInCall` is that predicate, once.
 *
 * `hasAnswered` is the distinction those seven copies could not make.
 * `ParticipantStatus` has five values and `invited` means the phone is still
 * ringing: that person may never pick up. Counting them as present is right for
 * "do not tear the call down yet" and wrong for "who is in this call" -- which
 * is why the bar said "In a call with alice" while alice's phone rang.
 */
import type { CallParticipant } from './call-state';

/** Still part of the call: has not hung up and has not refused. */
export function stillInCall(participant: CallParticipant): boolean {
  return participant.status !== 'left' && participant.status !== 'declined';
}

/** Actually on the call, as opposed to being rung. */
export function hasAnswered(participant: CallParticipant): boolean {
  return participant.status === 'connecting' || participant.status === 'active';
}
