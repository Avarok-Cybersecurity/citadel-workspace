/**
 * Your own office/room message does not count as unread.
 *
 * Live (owner, 2026-09-27), the unread-badge half of "I get a notification for my own
 * message": `applyGroupMessage` decided `fromSelf` by CID only, and an office channel's
 * `sender_id` is the account USERNAME, so every message you sent there raised your own badge.
 *
 * Mocked: the tab's CID -- multi-tab election; the username arrives on the event, as the
 * workspace response handler attaches it. The store rule under test is production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return 111n; } }) };
});

const { applyGroupMessage } = await import('../apply-group-message');
const { forgetSeenIds } = await import('@/lib/seen-ids');
import type { GroupConversation } from '@/types/group';

const groups = (): GroupConversation[] => [{ id: 'chan-1', unreadCount: 0, lastMessageTime: 0, lastMessagePreview: '' } as unknown as GroupConversation];
const byCid = (cid: bigint): string => cid.toString();

describe('an office/room message you sent', () => {
  beforeEach((): void => { forgetSeenIds(); });

  it('does not raise your unread count when the sender is your username', () => {
    const next: GroupConversation[] = applyGroupMessage(groups(), { groupId: 'chan-1', senderId: 'thomas', selfUsername: 'thomas', content: 'hi', messageId: 'm1', viewing: false }, 5, byCid);
    expect(next[0].unreadCount).toBe(0);
  });

  it("still counts someone else's office message", () => {
    const next: GroupConversation[] = applyGroupMessage(groups(), { groupId: 'chan-1', senderId: 'lara', selfUsername: 'thomas', content: 'hi', messageId: 'm2', viewing: false }, 5, byCid);
    expect(next[0].unreadCount).toBe(1);
  });

  it('is recognised through the store binding, by the username the binding is handed', async () => {
    vi.resetModules();
    const store: typeof import('../group-store') = await import('../group-store');
    const { eventEmitter } = await import('@/lib/event-emitter');
    store.startGroupEventBindings((): string => 'thomas');
    store.updateGroups(groups);
    // No selfUsername on the event: an office notification does not carry one.
    eventEmitter.emit('group:message-received', { groupId: 'chan-1', senderId: 'thomas', content: 'hi', messageId: 'm3' });
    expect(store.getGroups()[0].unreadCount).toBe(0);
  });
});
