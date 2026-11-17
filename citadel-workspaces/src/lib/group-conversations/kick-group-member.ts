/**
 * Remove a member from a peer group, and take them off the kicker's roster.
 *
 * The SDK tells the removed member (`Disconnected`) and every REMAINING member
 * except the kicker (`MemberStateChanged::LeftGroup`). The kicker gets only
 * `GroupKickSuccess`, which names no member. Nothing acted on it, so the owner's
 * member table and the group's info panel kept "Members (2)" and the removed
 * person until a reload.
 *
 * The request id is the one thing that ties the answer to the member, so it is
 * minted here and the wait is armed BEFORE the request goes out.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { sendGroupKick } from './group-requests';

/** Long enough for a relay round trip on a retransmitting link; short enough to fail. */
const KICK_TIMEOUT_MS: number = 30_000;
/** How long an answer is still applied after the user was told it had not come. */
const LATE_ANSWER_MS: number = 5 * 60_000;

const UNCONFIRMED: string =
  'The server did not confirm the removal in time. If it goes through, the member list will update.';

interface KickWait {
  answered: Promise<void>;
  stop: () => void;
}

function awaitKickAnswer(requestId: string, listenMs: number): KickWait {
  let stop: () => void = (): void => {};
  const answered: Promise<void> = new Promise<void>((resolve, reject) => {
    let done: boolean = false;
    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      eventEmitter.off('group:kick-succeeded', onSuccess);
      eventEmitter.off('group:failed', onFailed);
      fn();
    };
    const onSuccess = (payload: { requestId: string }): void => {
      if (payload.requestId === requestId) finish(resolve);
    };
    // The failure itself is toasted by group-failure-toasts; this only stops waiting.
    const onFailed = (payload: { requestId?: string; message: string }): void => {
      if (payload.requestId === requestId) finish(() => reject(new Error(payload.message || 'The server refused to remove that member.')));
    };
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      finish(() => reject(new Error('No answer to the removal arrived.')));
    }, listenMs);
    stop = (): void => finish((): void => reject(new Error('The removal was not sent.')));
    eventEmitter.on('group:kick-succeeded', onSuccess);
    eventEmitter.on('group:failed', onFailed);
  });
  return { answered, stop };
}

/**
 * Tell the user on the surface every other group failure uses. The server's
 * refusals arrive there as `GroupKickFailure`; a send that threw, or silence,
 * did not, and ended in a rejection nothing caught -- no toast, the dialog
 * closed, and the member still listed with no word as to why. No request id:
 * the wait for a late answer is still listening for this one.
 */
function reportKickFailure(message: string): void {
  eventEmitter.emit('group:failed', { operation: 'Kick', message });
}

/** Resolves once the member is removed; rejects, having told the user, otherwise. */
export async function kickGroupMember(groupId: string, memberCid: bigint): Promise<void> {
  const requestId: string = crypto.randomUUID();
  const wait: KickWait = awaitKickAnswer(requestId, LATE_ANSWER_MS);
  // The roster follows the server's answer whenever it lands, including after
  // the user was told it had not: a late success is still a removal.
  const applied: Promise<void> = wait.answered.then((): void => {
    // The same event a remaining member's LeftGroup produces, so one handler edits the roster.
    eventEmitter.emit('group:member-left', { groupId, memberCid });
  });
  // Refusals are reported by the server's own failure event (see onFailed), and
  // the other two ways this rejects are reported below.
  applied.catch((): void => undefined);
  try {
    await sendGroupKick(groupId, memberCid, requestId);
  } catch (error) {
    wait.stop();
    reportKickFailure(error instanceof Error ? error.message : String(error));
    throw error;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late: Promise<'late'> = new Promise<'late'>((resolve) => {
    timer = setTimeout((): void => resolve('late'), KICK_TIMEOUT_MS);
  });
  const outcome: 'removed' | 'late' = await Promise.race([applied.then((): 'removed' => 'removed'), late])
    .finally((): void => clearTimeout(timer));
  if (outcome === 'late') {
    reportKickFailure(UNCONFIRMED);
    throw new Error(UNCONFIRMED);
  }
}
