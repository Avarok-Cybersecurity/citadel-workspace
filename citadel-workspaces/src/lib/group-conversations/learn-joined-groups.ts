/**
 * The groups this session is in, for a browser that never watched it join them.
 *
 * The group list lives in the browser, and every event that fills it is one the
 * browser had to be present for: a create, an invitation, a message. So a member
 * signing in from a new browser saw "No conversations yet" for groups they were
 * in -- measured live, Lara and Max in a fresh browser, both in Sweep Group.
 *
 * The agent knows: its session's group channels are the membership it acts on,
 * restored by the server on every (re)connect, and `GroupListJoined` lists them.
 * That list comes from this person's own agent, so -- unlike a control message,
 * which never creates a group (apply-group-control) -- it is proof of membership.
 *
 * A key names only the owner. So a learnt group is added `awaitingState` and
 * asks the group for its state; the first snapshot a member sends in reply is
 * adopted whole (apply-group-control), and from then on the usual rules apply.
 */
import { eventEmitter } from '@/lib/event-emitter';
import { instanceManager } from '@/lib/multi-instance/instance-manager';
import { debugLog } from '@/lib/debug-config';
import type { GroupConversation } from '@/types/group';
import { getGroups, updateGroups } from './group-store';
import { isValidGroupId } from './group-key';
import { memberGroupRecord, usernameFrom } from './member-group-record';
import { announceGroupState, sendGroupControl } from './announce-group-state';
import type { GroupControlEvent } from './peer-group-control-inbound';

/** Add each listed group this browser does not hold, awaiting its state. Pure; `groups` when nothing is new. */
export function addJoinedGroups(
  groups: GroupConversation[],
  groupIds: readonly string[],
  self: bigint | null,
  selfUsername: string | undefined,
  usernameFor: (cid: bigint) => string,
): GroupConversation[] {
  const held: Set<string> = new Set(groups.map((group: GroupConversation) => group.id));
  const learnt: GroupConversation[] = [...new Set(groupIds)]
    .filter((id: string) => !held.has(id) && isValidGroupId(id))
    .map((groupId: string): GroupConversation => ({
      ...memberGroupRecord({ groupId, senderId: '', self, selfUsername, usernameFor }),
      awaitingState: true,
    }));
  return learnt.length === 0 ? groups : [...groups, ...learnt];
}

/**
 * Whether to answer a member's state request: only with a snapshot worth
 * adopting (not one still waiting for its own), and never to ourselves.
 */
export function shouldAnswerStateRequest(group: GroupConversation | undefined, sender: bigint, self: bigint | null): boolean {
  return group !== undefined && !group.awaitingState && self !== null && sender !== self;
}

/** Ask the agent which groups this session is in; the answer is `group:joined-list-received`. */
export async function requestJoinedGroups(): Promise<void> {
  const { sendGroupListJoinedRequest } = await import('./group-requests');
  await sendGroupListJoinedRequest();
}

function askForState(groupId: string): void {
  sendGroupControl(groupId, { request_state: true }).catch((error: unknown) => {
    // The group is listed either way; it keeps its placeholder name until a member speaks.
    debugLog('GroupJoined', `Could not ask ${groupId} for its state`, error);
  });
}

export function bindJoinedGroups(): void {
  eventEmitter.on('group:joined-list-received', (data: { groupIds: string[]; selfUsername?: string; memberUsernames?: Record<string, string> }) => {
    const before: Set<string> = new Set(getGroups().map((group: GroupConversation) => group.id));
    updateGroups((prev: GroupConversation[]) => addJoinedGroups(prev, data.groupIds, instanceManager.cid, data.selfUsername, usernameFrom(data.memberUsernames)));
    for (const id of new Set(data.groupIds)) {
      if (!before.has(id) && isValidGroupId(id)) askForState(id);
    }
  });

  eventEmitter.on('group:control-received', (data: GroupControlEvent) => {
    if (!data.control.request_state) return;
    const group: GroupConversation | undefined = getGroups().find((g: GroupConversation) => g.id === data.groupId);
    if (shouldAnswerStateRequest(group, data.senderCid, instanceManager.cid)) announceGroupState(group);
  });
}
