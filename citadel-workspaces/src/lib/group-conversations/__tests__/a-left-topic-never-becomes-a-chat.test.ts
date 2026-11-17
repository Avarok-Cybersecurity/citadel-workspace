/**
 * A topic the app has left stays out of the chat pipeline (p2p-demo-design §7 condition 3): the
 * session may still be in the group from another tab, the leave may fail, and messages already
 * on their way still arrive, so after TopicClose a message on that key is still not a
 * conversation. The topic port, the host's record (app-topic-groups.ts) and the filter are the
 * production ones; the agent is an in-memory AgentLink answering each request with its Success.
 */
import { describe, expect, it } from 'vitest';
import type { PeerAuthorization } from '@/lib/citadel-apps/member-consent-types';
import type { AgentLink } from '@/lib/citadel-apps/runtime/agent-link';
import { PeerAuthority } from '@/lib/citadel-apps/runtime/peer-authority';
import { topicPort, type OwnedTopicPort } from '@/lib/citadel-apps/runtime/topic-port';
import { encodeGroupMessage } from '../group-message-codec';
import { toGroupEvents, type GroupEvent } from '../group-events';
import { withoutAppTopics } from '../app-topic-filter';
import { appTopicGroups, markTopicGroup, markTopicRequest } from '../app-topic-groups';
import { InstallPlaneRegistry } from '@/lib/citadel-apps/runtime/install-plane-registry';

const ME: bigint = 111n;
const SUCCESS: Readonly<Record<string, string>> = { GroupRequestJoin: 'GroupRequestJoinSuccess', GroupLeave: 'GroupLeaveSuccess' };

function joinedTopic(groupId: string): OwnedTopicPort {
  const handlers: Set<(m: unknown) => void> = new Set<(m: unknown) => void>();
  let n: number = 0;
  const agent: AgentLink = {
    newRequestId: (): string => `left-${++n}`,
    listen: (h: (m: unknown) => void): (() => void) => { handlers.add(h); return (): void => { handlers.delete(h); }; },
    send: async (request: Record<string, unknown>): Promise<void> => {
      const [variant, body] = Object.entries(request)[0] as [string, Record<string, unknown>];
      queueMicrotask(() => handlers.forEach((h) => h({ [SUCCESS[variant]]: { cid: ME, group_key: body.group_key, request_id: body.request_id } })));
    },
  };
  const never = async (): Promise<PeerAuthorization> => ({ ok: false, why: 'NoHost' });
  return topicPort({
    seat: new InstallPlaneRegistry().attach('inst-1', 'net.avarok.compute-pool'),
    cid: ME, agent, topics: ['pool'], limits: { max_msg_bytes: 64, max_msgs_per_s: 2 }, timeoutMs: 1000,
    authority: new PeerAuthority(never, (): number => 0, 30), topicGroup: async (): Promise<string> => groupId,
    record: { group: markTopicGroup, request: markTopicRequest }, refused: (): void => undefined,
  });
}

function messageTo(mgid: bigint): GroupEvent[] {
  const body: Uint8Array = encodeGroupMessage({ group_id: `7:${mgid}`, message_id: 'm-1', sender_cid: 7n, content: '{"t":1}', timestamp: 1 });
  const m: Record<string, unknown> = { GroupMessageNotification: { cid: ME, peer_cid: 7n, message: Array.from(body), group_key: { cid: 7n, mgid }, request_id: 'r1' } };
  return withoutAppTopics(toGroupEvents(m, ME, 'bob', (cid: bigint): string => cid.toString()), appTopicGroups);
}

describe('a left topic', () => {
  it('is still not a conversation after the app closes it (control: a chat group’s message arrives)', async () => {
    const port: OwnedTopicPort = joinedTopic('7:61');
    expect(await port.TopicOpen({ name: 'pool' })).toEqual({ ok: { name: 'pool', members: [] } });
    expect(port.TopicClose({ name: 'pool' })).toEqual({ ok: null });
    await port.closeAll();
    expect(messageTo(61n)).toEqual([]);
    expect(messageTo(62n).map((e: GroupEvent) => e.name)).toEqual(['group:message-received']);
  });
});
