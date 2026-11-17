/**
 * The group store was memory-only and nothing rebuilt it: `refresh()` has no
 * caller and `GroupListGroupsSuccess` is handled nowhere. So every reload
 * emptied the sidebar, and opening a bookmarked /groups/:id reported "This group
 * may have been deleted" and bounced — for a group that still existed, with its
 * history still on the server, now unreachable.
 *
 * A previous localStorage attempt never once worked: member CIDs are bigint,
 * JSON.stringify throws on bigint, and the failure was swallowed. IndexedDB
 * stores bigint natively, which is why the project's CID rules put browser
 * persistence there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store: Map<string, unknown> = new Map<string, unknown>();
const cidRef: { current: bigint | null; } = { current: null as bigint | null };

vi.mock('@/lib/storage-utils', () => ({
  dbGet: vi.fn(async (_s: string, k: string) => store.get(k)),
  dbPut: vi.fn(async (_s: string, k: string, v: unknown) => { store.set(k, v); }),
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return cidRef.current; } }) };
});

import { loadPersistedGroups, persistGroups } from '../group-persistence';
import type { GroupConversation } from '@/types/group-entities';

const groupWithBigintMember: never = [{
  id: 'g1',
  name: 'Design',
  members: [{ cid: 12345678901234567890n, username: 'ada' }],
}] as never;

describe('group persistence', () => {
  beforeEach(() => { store.clear(); cidRef.current = null; });

  it('round-trips a member CID as bigint, which JSON could never do', async () => {
    cidRef.current = 111n;
    // Read first, exactly as the app does: restorePersistedGroups runs at
    // startup and persistGroups refuses to write a key it has not read, since
    // an empty list is otherwise indistinguishable from a lost one.
    await loadPersistedGroups();
    await persistGroups(groupWithBigintMember);

    const back: GroupConversation[] = await loadPersistedGroups();
    expect(back).toHaveLength(1);
    expect((back[0] as never as { members: { cid: bigint }[] }).members[0].cid)
      .toBe(12345678901234567890n);
  });

  it('keeps each account\'s groups separate', async () => {
    cidRef.current = 111n;
    await loadPersistedGroups();
    await persistGroups(groupWithBigintMember);
    expect(store.size, 'the write must have landed, or this asserts nothing').toBe(1);

    cidRef.current = 222n;
    expect(
      await loadPersistedGroups(),
      'one account inherited another\'s group list',
    ).toEqual([]);
  });

  it('stores nothing when there is no session to attribute it to', async () => {
    await persistGroups(groupWithBigintMember);
    expect(store.size).toBe(0);
  });

  it('reports no groups rather than throwing when the read fails', async () => {
    cidRef.current = 111n;
    const utils: typeof import('@/lib/storage-utils') = await import('@/lib/storage-utils');
    vi.mocked(utils.dbGet).mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(loadPersistedGroups()).resolves.toEqual([]);
  });
});
