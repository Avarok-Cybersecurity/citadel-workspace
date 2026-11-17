/**
 * Two accounts in one browser must not share a group list.
 *
 * The list is a module singleton and the restore is a union merge, so switching
 * accounts left the previous account's groups in the sidebar and merged the new
 * account's on top. Both were clickable. Persistence was already keyed per CID;
 * only the memory in front of it was not — the same shape as the permissions
 * cache that answered for the previous account (round 169).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted: vi.mock runs before the imports it replaces, so the spies have to
// be created inside the factory rather than closed over from module scope.
const { persistGroups, loadPersistedGroups } = vi.hoisted(() => ({
  persistGroups: vi.fn(async () => {}),
  loadPersistedGroups: vi.fn(async () => [] as unknown[]),
}));
vi.mock('../group-persistence', () => ({ persistGroups, loadPersistedGroups }));

import { getGroups, updateGroups, resetGroupsForSession, areGroupsHydrated } from '../group-store';
import type { GroupConversation } from '@/types/group';

const group = (id: string): GroupConversation => ({ id, name: id, members: [], unreadCount: 0 } as unknown as GroupConversation);

describe('switching accounts', () => {
  beforeEach(() => {
    persistGroups.mockClear();
    loadPersistedGroups.mockClear();
    updateGroups(() => [group('1:7'), group('1:9')]);
  });

  it('forgets the previous account s groups', async () => {
    await resetGroupsForSession();
    expect(getGroups()).toEqual([]);
  });

  it('does NOT write the empty list to storage', async () => {
    // The reset runs when the new account s CID arrives, so persistence is
    // already keyed to the NEW account. Persisting the cleared list here would
    // destroy exactly the groups the restore is about to read back.
    persistGroups.mockClear();
    await resetGroupsForSession();
    expect(persistGroups).not.toHaveBeenCalled();
  });

  it('loads the new account s groups instead', async () => {
    loadPersistedGroups.mockResolvedValueOnce([group('2:4')] as never);
    await resetGroupsForSession();
    expect(getGroups().map((g) => g.id)).toEqual(['2:4']);
  });

  it('leaves hydration true when it finishes, so consumers stop waiting', async () => {
    await resetGroupsForSession();
    expect(areGroupsHydrated()).toBe(true);
  });
});
