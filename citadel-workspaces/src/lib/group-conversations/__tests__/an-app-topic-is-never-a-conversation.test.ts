/**
 * An app topic's Citadel group is the app host's, never a conversation (p2p-demo-design §7,
 * condition 3). The agent hands this session every group it is in, so the chat pipeline drops
 * whatever the host recorded as a topic: a message to it, its creation answer, its membership
 * changes, and its id in a joined-list. Each case has its control: the same event for a chat
 * group still arrives.
 */
import { describe, expect, it } from 'vitest';
import { encodeGroupMessage } from '../group-message-codec';
import { toGroupEvents, type GroupEvent } from '../group-events';
import { withoutAppTopics, type AppTopicView } from '../app-topic-filter';

const TOPIC: string = '7:42';
const CHAT: string = '7:43';
const view: AppTopicView = { isTopicGroup: (id: string) => id === TOPIC, isTopicRequest: (id: string) => id === 'topic-create' };
const peerName = (cid: bigint): string => (cid === 7n ? 'ada' : cid.toString());
const names = (events: readonly GroupEvent[]): string[] => events.map((e: GroupEvent) => e.name);

function message(groupId: string, mgid: bigint): Record<string, unknown> {
  const body: Uint8Array = encodeGroupMessage({ group_id: groupId, message_id: 'm-1', sender_cid: 7n, content: '{"heartbeat":1}', timestamp: 1 });
  return { GroupMessageNotification: { cid: 111n, peer_cid: 7n, message: Array.from(body), group_key: { cid: 7n, mgid }, request_id: 'r1' } };
}

const run = (m: Record<string, unknown>): GroupEvent[] => withoutAppTopics(toGroupEvents(m, 111n, 'bob', peerName), view);

describe('an app topic is never a conversation', () => {
  it('a message to a topic group is dropped (control: one to a chat group arrives)', () => {
    expect(names(toGroupEvents(message(TOPIC, 42n), 111n, 'bob', peerName))).toEqual(['group:message-received']);
    expect(run(message(TOPIC, 42n))).toEqual([]);
    expect(names(run(message(CHAT, 43n)))).toEqual(['group:message-received']);
  });

  it('the answer to the host’s own create is dropped, by its request id', () => {
    const created = (requestId: string): Record<string, unknown> => ({ GroupCreateSuccess: { cid: 111n, group_key: { cid: 111n, mgid: 9n }, request_id: requestId } });
    expect(run(created('topic-create'))).toEqual([]);
    expect(names(run(created('chat-create')))).toEqual(['group:created']);
  });

  it('a joined-list keeps its chat groups and loses its topics', () => {
    const listed: GroupEvent[] = run({ GroupListJoinedSuccess: { cid: 111n, groups: [{ cid: 7n, mgid: 42n }, { cid: 7n, mgid: 43n }], request_id: 'r2' } });
    expect(listed.map((e: GroupEvent) => e.payload.groupIds)).toEqual([[CHAT]]);
  });

  it('a member joining a topic is not a member joining a chat', () => {
    const joined = (mgid: bigint): Record<string, unknown> => ({ GroupMemberStateChangeNotification: { cid: 111n, group_key: { cid: 7n, mgid }, state: { EnteredGroup: { cids: [8n] } }, request_id: null } });
    expect(names(toGroupEvents(joined(42n), 111n, 'bob', peerName))).toEqual(['group:member-joined']);
    expect(run(joined(42n))).toEqual([]);
    expect(names(run(joined(43n)))).toEqual(['group:member-joined']);
  });
});
