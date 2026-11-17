/**
 * Opening a group chat was a perpetual render-and-write loop.
 *
 * `markAsRead` used `prev.map(...)`, which always allocates. The store's only
 * no-op guard is identity — `if (next === groups) return` — so every call, even
 * one that changed nothing, notified every subscriber and fired an IndexedDB
 * write. The group page calls it from an effect whose deps include `getGroup`,
 * whose identity derives from `groups`. New array, new getGroup, effect re-runs,
 * call again: a hot tab, or React's "Maximum update depth exceeded", depending
 * on scheduling.
 *
 * The test asserts the store fact the loop hung from — that a mark-as-read with
 * nothing to mark does not produce a new array — rather than trying to observe a
 * render loop, which is exactly the kind of thing a test can watch not happen
 * for the wrong reason.
 */

import { describe, it, expect, vi, beforeEach   } from 'vitest';

const persistGroups: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/group-conversations/group-persistence', () => ({
  persistGroups: (...args: unknown[]): unknown => persistGroups(...args),
  restoreGroups: vi.fn().mockResolvedValue([]),
}));

import { markGroupRead } from '@/lib/group-conversations/mark-group-read';
import type { GroupConversation } from '@/types/group-entities';

/** The real updater, imported rather than restated: a copy would keep passing
 *  after the hook stopped using it. */
type Group = Parameters<typeof markGroupRead>[0][number];
const markAsReadUpdater: (groupId: string) => (prev: Group[]) => GroupConversation[] = (groupId: string): (prev: Group[]) => GroupConversation[] => (prev: Group[]): GroupConversation[] =>
  markGroupRead(prev, groupId);

describe('marking a group read', () => {
  beforeEach(() => persistGroups.mockClear());

  it('returns the same array when the count is already zero', () => {
    const groups: GroupConversation[] = [{ id: 'a', unreadCount: 0 } as Group];

    // Identity, not deep equality. Identity is the whole mechanism: the store
    // compares with === and a new array with identical contents restarts the
    // loop just as surely as a different one.
    expect(markAsReadUpdater('a')(groups)).toBe(groups);
  });

  it('returns the same array when the group is not there at all', () => {
    const groups: GroupConversation[] = [{ id: 'a', unreadCount: 3 } as Group];
    expect(markAsReadUpdater('missing')(groups)).toBe(groups);
  });

  it('still clears a real unread count', () => {
    const groups: GroupConversation[] = [{ id: 'a', unreadCount: 3 } as Group, { id: 'b', unreadCount: 1 } as Group];
    const next: GroupConversation[] = markAsReadUpdater('a')(groups);

    expect(next).not.toBe(groups);
    expect(next[0].unreadCount).toBe(0);
    expect(next[1].unreadCount).toBe(1);
  });

  it('the store treats an unchanged array as nothing to do', async () => {
    const store: typeof import('@/lib/group-conversations/group-store') = await import('@/lib/group-conversations/group-store');
    const listener: ReturnType<typeof vi.fn> = vi.fn();
    const unsubscribe: () => void = store.subscribeToGroups(listener);

    store.updateGroups((prev) => prev);

    expect(listener).not.toHaveBeenCalled();
    expect(persistGroups).not.toHaveBeenCalled();
    unsubscribe();
  });
});
