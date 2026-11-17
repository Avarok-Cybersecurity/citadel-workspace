/**
 * A message that arrives in the group the user is looking at is not unread.
 *
 * The group badge was cleared once, when the page mounted, and counted every
 * later arrival, so reading a conversation while it filled left a badge on its
 * own sidebar row. P2P already refuses to count what a window in front shows
 * (and notifications use the same rule); the store did not ask.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';

vi.mock('@/lib/multi-instance/instance-manager', () => ({
  instanceManager: { get cid(): bigint | null { return 7n; } },
}));

const front: { value: boolean } = vi.hoisted((): { value: boolean } => ({ value: true }));
vi.mock('@/lib/agent-conversations/report-focus', () => ({
  windowInFront: (): boolean => front.value,
}));

async function freshStore(): Promise<{
  store: typeof import('../group-store');
  open: typeof import('../open-channel');
  eventEmitter: (typeof import('@/lib/event-emitter'))['eventEmitter'];
}> {
  vi.resetModules();
  const store: typeof import('../group-store') = await import('../group-store');
  const open: typeof import('../open-channel') = await import('../open-channel');
  const { eventEmitter } = await import('@/lib/event-emitter');
  store.startGroupEventBindings(noSessionUsername);
  store.updateGroups(() => [{ id: 'g1', name: 'G', members: [], unreadCount: 0 } as never]);
  return { store, open, eventEmitter };
}

const arrival = (id: string): { groupId: string; senderId: string; content: string; messageId: string } =>
  ({ groupId: 'g1', senderId: '42', content: 'hi', messageId: id });

describe('unread count for the conversation on screen', () => {
  beforeEach(() => { front.value = true; });
  afterEach(() => { vi.resetModules(); });

  it('does not count a message in the open group of a window in front', async () => {
    const { store, open, eventEmitter } = await freshStore();
    open.markChannelOpen('g1');
    eventEmitter.emit('group:message-received', arrival('m1'));
    expect(store.getGroups()[0]?.unreadCount).toBe(0);
  });

  it('counts it when the window is behind another', async () => {
    const { store, open, eventEmitter } = await freshStore();
    open.markChannelOpen('g1');
    front.value = false;
    eventEmitter.emit('group:message-received', arrival('m2'));
    expect(store.getGroups()[0]?.unreadCount).toBe(1);
  });

  it('counts it when the group is not the one open', async () => {
    const { store, eventEmitter } = await freshStore();
    eventEmitter.emit('group:message-received', arrival('m3'));
    expect(store.getGroups()[0]?.unreadCount).toBe(1);
  });
});
