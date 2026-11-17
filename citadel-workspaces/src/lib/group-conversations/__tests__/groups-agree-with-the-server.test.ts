/**
 * A group deleted while you were offline must stop appearing.
 *
 * Every group event is additive or arrives only while you are online: a create
 * you performed, an invite you received, a deletion you were connected to be
 * told about. Restore is a union merge. So nothing could ever REMOVE a group
 * the client did not watch disappear — it survived every reload, because
 * restore read it back and merged it in again.
 */
// The reconciliation only judges groups THIS account owns, so the store-level tests have to
// say who that is. `null` here would be the "we cannot attribute ownership" path, which
// correctly removes nothing — and would make the removal tests below pass for the wrong reason.
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: 1n }) };
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

// The wire is the only thing mocked: sendGroupListRequest reaches a WebSocket.
// Everything else here -- the store, the mapping, the snapshot rule -- is the
// production code, which is the whole point of testing the seam and not the
// hook.
vi.mock('../group-requests', () => ({ sendGroupListRequest: vi.fn(async () => {}) }));
import {
  reconcileGroups,
  applyGroupList,
  requestGroupReconcile,
  resetGroupReconcileState,
} from '../reconcile-groups';
import { getGroups, updateGroups } from '../group-store';
import { toGroupEvents } from '../group-events';
import type { GroupConversation } from '@/types/group';
import type { GroupEvent } from '@/lib/group-conversations/group-events';

function group(id: string): GroupConversation {
  return {
    id,
    name: id,
    ownerId: '1',
    members: [],
    createdAt: 0,
    unreadCount: 0,
    lastMessageTime: 0,
    lastMessagePreview: '',
    roles: [],
  } as unknown as GroupConversation;
}

const key: (mgid: string) => { cid: bigint; mgid: bigint; } = (mgid: string): { cid: bigint; mgid: bigint; } => ({ cid: BigInt(1), mgid: BigInt(mgid) });

describe('reconcileGroups', () => {
  it('drops a group the server no longer lists', () => {
    const held: GroupConversation[] = [group('1:7'), group('1:9')];
    const next: GroupConversation[] = reconcileGroups(held, ['1:7'], new Set(['1:7', '1:9']), 1n);
    expect(next.map((g) => g.id)).toEqual(['1:7']);
  });

  it('keeps a group created after the request went out', () => {
    // The server's snapshot predates it, so its absence proves nothing. Judging
    // it by that answer deletes a group the user just made.
    const held: GroupConversation[] = [group('1:7'), group('1:99')];
    const next: GroupConversation[] = reconcileGroups(held, ['1:7'], new Set(['1:7']), 1n);
    expect(next.map((g) => g.id)).toEqual(['1:7', '1:99']);
  });

  it('returns the same array when nothing changed, so no listener re-renders', () => {
    const held: GroupConversation[] = [group('1:7')];
    expect(reconcileGroups(held, ['1:7'], new Set(['1:7']), 1n)).toBe(held);
  });
});

describe('the list response', () => {
  it('maps GroupListGroupsSuccess to group ids', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupListGroupsSuccess: { cid: BigInt(1), group_list: [key('7'), key('9')] } },
      BigInt(1),
      'me',
      () => 'peer',
    );
    expect(events).toEqual([
      { name: 'group:list-received', payload: { groupIds: ['1:7', '1:9'] } },
    ]);
  });

  it('emits NOTHING when group_list is null', () => {
    // Option<Vec<..>> on the wire. Null is "no answer", not "you are in no
    // groups" — reconciling against it deletes every group the account has.
    const events: GroupEvent[] = toGroupEvents(
      { GroupListGroupsSuccess: { cid: BigInt(1), group_list: null } },
      BigInt(1),
      'me',
      () => 'peer',
    );
    expect(events).toEqual([]);
  });

  it('accepts an empty list, which DOES mean no groups', () => {
    const events: GroupEvent[] = toGroupEvents(
      { GroupListGroupsSuccess: { cid: BigInt(1), group_list: [] } },
      BigInt(1),
      'me',
      () => 'peer',
    );
    expect(events).toEqual([
      { name: 'group:list-received', payload: { groupIds: [] } },
    ]);
  });
});

describe('through the store', () => {
  beforeEach(() => {
    resetGroupReconcileState();
    updateGroups(() => [group('1:7'), group('1:9')]);
  });

  it('ignores a list nobody asked for', () => {
    // A late list — one that arrives after a reconnect, say — judges groups
    // created since by an answer that predates all of them. With no request
    // outstanding, the only safe reading of a list is none.
    applyGroupList(['1:7']);
    expect(getGroups().map((g) => g.id)).toEqual(['1:7', '1:9']);
  });

  it('removes the missing group once one WAS asked for', async () => {
    // The positive control for the test above: same call, same list, opposite
    // outcome — so "ignored" is a decision and not an inert code path.
    await requestGroupReconcile();
    applyGroupList(['1:7']);
    expect(getGroups().map((g) => g.id)).toEqual(['1:7']);
  });

  it('answers only the request in flight — a second list is ignored', async () => {
    await requestGroupReconcile();
    applyGroupList(['1:7']);
    applyGroupList([]);
    expect(getGroups().map((g) => g.id)).toEqual(['1:7']);
  });
});

/**
 * A list of the groups you OWN says nothing about the groups you were invited to.
 *
 * The request behind it is `list_owned_groups`, and the SDK map is keyed by owner CID, so a
 * group somebody else created is never in the answer — present or not. Judging those by
 * absence deleted every group an invitee had been added to, from the sidebar and from storage,
 * on every login and every reload.
 */
describe('a group you did not create is still yours', () => {
  it("keeps a group owned by someone else, though the server did not list it", () => {
    const held: GroupConversation[] = [group('9:42')]; // owner 9, we are 1
    const next: GroupConversation[] = reconcileGroups(held, [], new Set(['9:42']), 1n);
    expect(next, "an invitee's group was deleted by a list that never mentions it").toEqual(held);
  });

  it('still removes a group we own that the server no longer lists', () => {
    const held: GroupConversation[] = [group('1:7'), group('9:42')];
    const next: GroupConversation[] = reconcileGroups(held, [], new Set(['1:7', '9:42']), 1n);
    expect(next.map((g) => g.id)).toEqual(['9:42']);
  });

  it('removes nothing when we cannot say who we are', () => {
    const held: GroupConversation[] = [group('1:7')];
    expect(reconcileGroups(held, [], new Set(['1:7']), null)).toBe(held);
  });

  it('does not judge an id it cannot parse', () => {
    const held: GroupConversation[] = [group('not-an-id')];
    expect(reconcileGroups(held, [], new Set(['not-an-id']), 1n)).toBe(held);
  });
});
