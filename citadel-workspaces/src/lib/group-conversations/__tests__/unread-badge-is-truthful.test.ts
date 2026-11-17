/**
 * A group's unread badge counted the user's own messages and could never be
 * cleared.
 *
 * The server answers the SENDER with the same GroupMessageNotification it
 * broadcasts to everyone else — that echo is what confirms a send — and the
 * store incremented on every one with no sender check. Send three messages into
 * a group and your own sidebar badge reads 3. Meanwhile `markAsRead` existed on
 * the hook with zero callers anywhere in the app, so there was no path back to
 * zero short of a reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';

const h: { cid: bigint | null; } = vi.hoisted((): { cid: bigint | null; } => ({ cid: null as bigint | null }));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return h.cid; } }) };
});

const SELF: bigint = 7n;
const OTHER: bigint = 42n;

async function freshStore(): Promise<{
  store: typeof import('../group-store');
  eventEmitter: (typeof import('@/lib/event-emitter'))['eventEmitter'];
}> {
  vi.resetModules();
  const store: typeof import('../group-store') = await import('../group-store');
  // The emitter must come from the SAME module graph as the store. Importing it
  // at the top of the file gives the pre-reset instance, so every event went to
  // an emitter the store was not listening on — and the "does not count own
  // message" test passed for that reason rather than the intended one.
  const { eventEmitter } = await import('@/lib/event-emitter');
  store.startGroupEventBindings(noSessionUsername);
  return { store, eventEmitter };
}

beforeEach(() => {
  h.cid = SELF;
});

describe('group unread count', () => {
  it('does not count a message the user sent themselves', async () => {
    const { store, eventEmitter } = await freshStore();
    store.updateGroups(() => [
      { id: 'g1', name: 'G', members: [], unreadCount: 0 } as never,
    ]);

    eventEmitter.emit('group:message-received', {
      groupId: 'g1',
      senderId: String(SELF),
      content: 'hello',
    });

    expect(store.getGroups().find((g) => g.id === 'g1')?.unreadCount).toBe(0);
  });

  it('counts a message from someone else', async () => {
    const { store, eventEmitter } = await freshStore();
    store.updateGroups(() => [
      { id: 'g1', name: 'G', members: [], unreadCount: 0 } as never,
    ]);

    eventEmitter.emit('group:message-received', {
      groupId: 'g1',
      senderId: String(OTHER),
      content: 'hello',
    });

    expect(store.getGroups().find((g) => g.id === 'g1')?.unreadCount).toBe(1);
  });
});
