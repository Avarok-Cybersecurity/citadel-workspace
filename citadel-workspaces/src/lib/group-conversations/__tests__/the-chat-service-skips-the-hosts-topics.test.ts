/**
 * The group response service consults the app host's topic record: once the host marks a group
 * as a topic, its messages reach no conversation, while a chat group's still do. The pure rule is
 * in an-app-topic-is-never-a-conversation; this is its wiring.
 *
 * Doubles, as in a-group-names-people-not-cids: the roster (network-backed), the tab's stored
 * selection (storage I/O) and the connection (the socket singleton) -- the service's three reads
 * of the outside world. The event pipeline, the codec and the topic record are the real ones.
 */
import { describe, it, expect, vi } from 'vitest';

const SELF: bigint = 111n;

vi.mock('@/lib/p2p-registration-service', () => ({
  p2pRegistrationService: { getPeers: (): unknown => ({ registeredPeers: [], allPeers: [] }) },
}));
vi.mock('@/lib/tab-context', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return { ...actual, getSelectedUser: async (): Promise<unknown> => ({ selectedUsername: 'bob' }) };
});
vi.mock('@/lib/connection', async (importOriginal: () => Promise<typeof import('@/lib/connection')>) => {
  const actual: typeof import('@/lib/connection') = await importOriginal();
  const { doubleOf } = await import('@/test/singleton-double');
  return { ...actual, connectionManager: doubleOf(actual.connectionManager, { getConnectionInfo: ((): { cid: bigint } => ({ cid: SELF })) as never }) };
});

const { eventEmitter } = await import('@/lib/event-emitter');
const { encodeGroupMessage } = await import('../group-message-codec');
const { markTopicGroup } = await import('../app-topic-groups');
const { startGroupResponseService } = await import('../group-response-service');
startGroupResponseService();

function message(mgid: bigint): Record<string, unknown> {
  const groupId: string = `7:${mgid.toString()}`;
  const body: Uint8Array = encodeGroupMessage({ group_id: groupId, message_id: `m-${groupId}`, sender_cid: 7n, content: 'x', timestamp: 1 });
  return { GroupMessageNotification: { cid: SELF, peer_cid: 7n, message: Array.from(body), group_key: { cid: 7n, mgid }, request_id: null } };
}

describe('the chat service skips the host’s topics', () => {
  it('a topic group’s message reaches no conversation; a chat group’s does', async () => {
    markTopicGroup('7:42');
    const heard: string[] = [];
    const off: () => void = eventEmitter.on('group:message-received', (p: { groupId: string }): void => { heard.push(p.groupId); });
    eventEmitter.emit('websocket-message', message(42n));
    eventEmitter.emit('websocket-message', message(43n));
    await vi.waitFor(() => expect(heard).toContain('7:43'));
    off();
    expect(heard).toEqual(['7:43']);
  });
});
