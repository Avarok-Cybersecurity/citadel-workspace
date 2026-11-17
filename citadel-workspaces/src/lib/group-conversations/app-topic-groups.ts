/**
 * The app host's record of which Citadel groups are app topics (runtime/topic-port.ts writes it;
 * group-response-service reads it through app-topic-filter.ts). Learning a topic group also drops
 * any chat record of it a joined-list may have added first: the host can learn a key after the
 * agent listed the group.
 *
 * Nothing is ever forgotten while the tab lives. Leaving a topic does not end the group for this
 * session: another tab of the same account may still be in it, a leave can fail, and messages
 * already in flight still arrive, and each of those would otherwise surface as a phantom chat. A
 * group key is never reused for another group (its mgid is fresh per creation), so keeping it
 * excludes nothing that could ever be a chat.
 */
import type { GroupConversation } from '@/types/group';
import type { AppTopicView } from './app-topic-filter';
import { updateGroups } from './group-store';

const groups: Set<string> = new Set<string>();
const requests: Set<string> = new Set<string>();

export const appTopicGroups: AppTopicView = {
  isTopicGroup: (groupId: string): boolean => groups.has(groupId),
  isTopicRequest: (requestId: string): boolean => requests.has(requestId),
};

/** The topic port is creating a group with this request id; its answer is not a chat. */
export function markTopicRequest(requestId: string): void {
  requests.add(requestId);
}

export function markTopicGroup(groupId: string): void {
  groups.add(groupId);
  updateGroups((prev: GroupConversation[]) => (prev.some((g: GroupConversation) => g.id === groupId) ? prev.filter((g: GroupConversation) => g.id !== groupId) : prev));
}
