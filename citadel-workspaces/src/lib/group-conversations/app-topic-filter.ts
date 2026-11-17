/**
 * App topics ride Citadel groups of their own, one per (install, topic) — never a chat group
 * (docs/plans/p2p-demo-design.md §7, condition 3). The agent hands this session every group it
 * is in, topic or chat, so the chat pipeline skips what the app host says is a topic: its group
 * ids, and the requests it made to create one. Without this, an app's heartbeats would appear as
 * a conversation and a topic group would be asked for chat state. Pure over the view it is given.
 */
import type { GroupEvent } from './group-events';

export interface AppTopicView {
  readonly isTopicGroup: (groupId: string) => boolean;
  readonly isTopicRequest: (requestId: string) => boolean;
}

/** The events with every app-topic group left out: dropped when they name one, filtered when they list several. */
export function withoutAppTopics(events: readonly GroupEvent[], view: AppTopicView): GroupEvent[] {
  const out: GroupEvent[] = [];
  for (const event of events) {
    const p: Record<string, unknown> = event.payload;
    if (typeof p.groupId === 'string' && view.isTopicGroup(p.groupId)) continue;
    if (typeof p.requestId === 'string' && view.isTopicRequest(p.requestId)) continue;
    if (Array.isArray(p.groupIds)) {
      const ids: unknown[] = p.groupIds.filter((id: unknown) => !(typeof id === 'string' && view.isTopicGroup(id)));
      out.push(ids.length === p.groupIds.length ? event : { ...event, payload: { ...p, groupIds: ids } });
      continue;
    }
    out.push(event);
  }
  return out;
}
