/**
 * The id of the group a create request actually made.
 *
 * `sendGroupCreate` resolves with its own `crypto.randomUUID()` request id.
 * That is not a group id: groups are keyed `<cid>:<mgid>`, which is what
 * `group:created` carries and what every row, route and store entry uses.
 *
 * Two rounds were built on the wrong value before anything noticed, because a
 * uuid looks exactly like an id:
 *
 *   - round 425 remembered the creator's chosen name under the request id, so
 *     `chosenGroupName` never matched and the group kept its fallback label;
 *   - round 427 navigated to `/groups/<request id>` — a route for a group that
 *     does not exist — and the spec read the url back and reported "Group
 *     created successfully", which is how a false success is built out of two
 *     correct-looking halves.
 *
 * The response carries the request id, so the answer can be recognised rather
 * than guessed at. Waiting on "the next `group:created`" would have been wrong
 * for a reason worth stating: an invite arriving at the same moment emits one
 * too, and the caller would navigate into somebody else's group.
 */
import { eventEmitter } from '@/lib/event-emitter';

/** Long enough for a peer round trip on a retransmitting link; short enough to fail. */
const DEFAULT_TIMEOUT_MS: number = 30_000;

export function awaitGroupCreated(
  requestId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let done: boolean = false;
    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      eventEmitter.off('group:created', onCreated);
      fn();
    };

    const onCreated = (payload: { groupId: string; requestId?: string }): void => {
      if (payload.requestId !== requestId) return;
      finish(() => resolve(payload.groupId));
    };

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      finish(() => reject(new Error('The group was not created in time.')));
    }, timeoutMs);

    eventEmitter.on('group:created', onCreated);
  });
}
