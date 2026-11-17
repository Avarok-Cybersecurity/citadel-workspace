/**
 * A message you sent into a peer group appeared in the thread and left the
 * sidebar showing the previous one.
 *
 * `group:message-received` has two consumers: `bind-peer-group-delivery`, which
 * puts the message in the open conversation, and the group store, which owns
 * the sidebar's preview, unread badge and recency sort. `sendGroupMessageAnywhere`
 * called the thread deliverer DIRECTLY, so it reached the first and skipped the
 * second — the group never rose to the top of the list, and its preview stayed
 * on whatever arrived before.
 *
 * The two halves of one delivery, wired on one side. Emitting the event reaches
 * both, and is not a second delivery: the binding is the only caller of
 * `deliverPeerGroupMessage`, and the store dedupes on `messageId`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<{ groupId: string; content: string; groupName?: string }> = [];
vi.mock('../group-requests', () => ({
  sendPeerGroupMessage: async (groupId: string, content: string, _replyTo?: string, groupName?: string): Promise<string> => {
    sent.push({ groupId, content, groupName });
    return 'msg-1';
  },
}));
vi.mock('../group-send-transport', () => ({ groupSendTransport: (): string => 'peer' }));
vi.mock('@/lib/workspace-service', () => ({ default: { sendGroupMessage: async (): Promise<void> => undefined } }));

let ownCid: bigint | null = 111n;
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return ownCid; } }) };
});

const { eventEmitter }: typeof import('@/lib/event-emitter') = await import('@/lib/event-emitter');
const { sendGroupMessageAnywhere }: typeof import('../send-group-message') = await import('../send-group-message');

describe('sending into a peer group', () => {
  beforeEach((): void => { sent.length = 0; ownCid = 111n; });

  it('announces the message the sidebar listens for', async (): Promise<void> => {
    const heard: Array<Record<string, unknown>> = [];
    const listener = (data: Record<string, unknown>): void => { heard.push(data); };
    eventEmitter.on('group:message-received', listener);

    try {
      await sendGroupMessageAnywhere('group-1', 'hello');
    } finally {
      eventEmitter.off('group:message-received', listener);
    }

    expect(heard, 'the sidebar was never told, so the preview and recency sort stayed stale').toHaveLength(1);
    expect(heard[0].groupId).toBe('group-1');
    expect(heard[0].content).toBe('hello');
  });

  it('carries the id the store dedupes on', async (): Promise<void> => {
    // Without it the store refuses the message entirely (see
    // bind-peer-group-delivery: "no id means this did not come through the peer
    // envelope"), so the sidebar would still not update.
    const heard: Array<Record<string, unknown>> = [];
    const listener = (data: Record<string, unknown>): void => { heard.push(data); };
    eventEmitter.on('group:message-received', listener);

    try {
      await sendGroupMessageAnywhere('group-1', 'hello');
    } finally {
      eventEmitter.off('group:message-received', listener);
    }

    expect(heard[0].messageId).toBe('msg-1');
  });

  it('still actually sends it to the peers', async (): Promise<void> => {
    // The opposite failure: emitting instead of sending would update the sidebar
    // for a message nobody received, and the assertions above cannot see it.
    await sendGroupMessageAnywhere('group-1', 'hello');

    expect(sent).toEqual([{ groupId: 'group-1', content: 'hello' }]);
  });

  it("tells the members the group's name when this session owns it", async (): Promise<void> => {
    // GroupCreate and GroupInvite carry no name, so the owner's messages are
    // how members learn it. A member's own local name is not announced.
    const { updateGroups }: typeof import('../group-store') = await import('../group-store');
    const group = (id: string): import('@/types/group').GroupConversation => ({
      id, name: 'Team 0924', ownerId: 0n, members: [], settings: { roles: [], defaultRoleId: '' }, unreadCount: 0,
    });
    updateGroups((): import('@/types/group').GroupConversation[] => [group('111:5'), group('222:5')]);

    await sendGroupMessageAnywhere('111:5', 'hello');
    await sendGroupMessageAnywhere('222:5', 'hello');

    expect(sent.map((m) => m.groupName)).toEqual(['Team 0924', undefined]);
  });
});
