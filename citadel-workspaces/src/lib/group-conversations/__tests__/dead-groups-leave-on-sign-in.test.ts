/**
 * The groups that died with the server's in-memory registry must leave the sidebar.
 *
 * Live, work.avarok.net: alice's sidebar listed twelve groups she owns, most of them wiped
 * by Worker deploys before the server persisted its registry. The reconciler that removes
 * owned groups the server no longer lists existed and was correct in isolation — but it was
 * armed by `instance:cid-changed`, and it subscribes only when the first group consumer
 * MOUNTS. Sign-in and resume both set the cid before the workspace renders, and the cid is
 * permanent, so the event had always fired, once, to nobody. The request was never sent.
 *
 * Mocked, and only these: the instance manager (a singleton over BroadcastChannel; here it
 * stands for "the session was set before we mounted"), IndexedDB (the persisted list the
 * restore reads back), and the wire send. The bindings, the store, the response mapping and
 * the reconciliation are all production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';

const { ALICE, loadPersistedGroups, sendGroupListRequest } = vi.hoisted(() => ({
  ALICE: 12884901889n,
  loadPersistedGroups: vi.fn(async (): Promise<unknown[]> => []),
  sendGroupListRequest: vi.fn(async (): Promise<void> => {}),
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { cid: ALICE }) };
});
vi.mock('../group-persistence', () => ({ loadPersistedGroups, persistGroups: vi.fn(async (): Promise<void> => {}) }));
vi.mock('../group-requests', () => ({ sendGroupListRequest }));

import { eventEmitter } from '@/lib/event-emitter';
import { getGroups, startGroupEventBindings } from '../group-store';
import { toGroupEvents, type GroupEvent } from '../group-events';
import type { GroupConversation } from '@/types/group';

const BOB: bigint = 17179869185n;
const LIVE_MGID: bigint = 340282366920938463463374607431768211001n;
const DEAD_MGIDS: bigint[] = [11n, 12n, 13n, 14n, 15n, 16n, 17n, 18n, 19n, 20n, 21n];

const group = (owner: bigint, mgid: bigint): GroupConversation =>
  ({ id: `${owner.toString()}:${mgid.toString()}`, name: mgid.toString(), ownerId: owner, members: [], unreadCount: 0 } as unknown as GroupConversation);

/** The agent's answer, shaped as group_list_groups.rs builds it: `GroupListGroupsSuccess` with `Option<Vec<MessageGroupKey>>`. */
function serverAnswer(): Record<string, unknown> {
  return {
    GroupListGroupsSuccess: {
      cid: ALICE,
      peer_cid: null,
      request_id: '6f1c2f4e-2b8a-4d55-9d53-2f0f8f9a1c11',
      group_list: [{ cid: ALICE, mgid: LIVE_MGID }],
    },
  };
}

describe('a session that was live before the sidebar mounted', () => {
  beforeEach(() => {
    loadPersistedGroups.mockResolvedValue([
      group(ALICE, LIVE_MGID),
      ...DEAD_MGIDS.map((mgid: bigint): GroupConversation => group(ALICE, mgid)),
      group(BOB, 5n),
    ]);
  });

  it('asks the server, and drops the owned groups it no longer lists', async () => {
    startGroupEventBindings(noSessionUsername);
    await vi.waitFor(() => expect(sendGroupListRequest, 'the list was never requested on mount').toHaveBeenCalled());

    const events: GroupEvent[] = toGroupEvents(serverAnswer(), ALICE, 'alice', (): string => 'peer');
    for (const event of events) eventEmitter.emit(event.name, event.payload);

    expect(getGroups().map((g: GroupConversation): string => g.id).sort()).toEqual(
      [`${ALICE.toString()}:${LIVE_MGID.toString()}`, `${BOB.toString()}:5`].sort(),
    );
  });
});
