/**
 * Every `Group*Failure` the wire can carry.
 *
 * Its own module because `group-events.ts` sits at the 250-line cap and this is
 * a cohesive unit: one list, one rule about it, and two tests that consume it.
 *
 * The rule is that this list must equal the generated `Group*Failure` types
 * EXACTLY, in both directions, and
 * `__tests__/every-group-failure-is-handled.test.ts` enforces it. When it was
 * maintained by hand inside the loop that reads it, it drifted both ways at
 * once: it named `GroupJoinFailure` and `GroupDisconnectFailure`, neither of
 * which exists, and omitted five that do.
 *
 * The costly omission was `GroupRespondRequestFailure`. Accepting an invitation
 * commits the group locally first, so when the server refused -- a stale key, a
 * group that ended, a responder who is not the owner -- no arm matched, nothing
 * was said, and the user kept a group in their sidebar the server never counted
 * them into.
 */
import type { ResponseType } from 'citadel-workspace-client-ts';
import { everyMember } from '@/types/every-member';

/** The wire's group failures; the list below fails to compile when one is added or removed. */
type GroupFailure = Extract<ResponseType, `Group${string}Failure`>;

export const GROUP_FAILURE_VARIANTS: readonly GroupFailure[] = everyMember<GroupFailure>()([
  'GroupBroadcastHandleFailure',
  'GroupChannelCreateFailure',
  'GroupCreateFailure',
  'GroupEndFailure',
  'GroupInviteFailure',
  'GroupKickFailure',
  'GroupLeaveFailure',
  'GroupListGroupsFailure',
  'GroupListJoinedFailure',
  'GroupMessageFailure',
  'GroupRequestJoinFailure',
  'GroupRespondRequestFailure',
]);
