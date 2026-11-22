/**
 * What the group itself did reaches its members, in words that say which thing happened.
 *
 *   - A refused message: a toast with the reason ("You are no longer a member of this group").
 *   - A refused end: the owner is told, and the group stays.
 *   - The group passing to a new owner: the store's owner moves, and everyone is told who.
 *   - The group resuming on this device: whether its history came with it.
 *   - The group going: ended by its owner, you were removed, or it ended because its owner left,
 *     which offers to start a new group.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroupConversation, GroupRole } from '@/types/group';

const toasts: Array<{ title: string; description: string; action?: { label: string; onClick: () => void } }> = [];
// The toast is the user-facing edge; what it is handed is the behaviour.
vi.mock('@/hooks/use-toast', () => ({ toast: (t: (typeof toasts)[number]): void => { toasts.push(t); } }));

const { eventEmitter } = await import('@/lib/event-emitter');
const { toGroupEvents } = await import('../group-events');
const { bindGroupProtocolEvents } = await import('../bind-group-protocol-events');
const { bindGroupRemovalNotice, START_NEW_GROUP_EVENT } = await import('../group-removal-notice');
const { bindGroupFailureToasts } = await import('../group-failure-toasts');
const { createDefaultRoles } = await import('@/types/group-permissions');
const { instanceManager } = await import('@/lib/multi-instance/instance-manager');

const SELF: bigint = 33n;
const CREATOR: bigint = 11n;
const KEY: { cid: bigint; mgid: bigint } = { cid: CREATOR, mgid: 5n };
const ID: string = '11:5';
const nameOf = (cid: bigint): string => (cid === 22n ? 'bea' : `cid-${cid.toString()}`);

const roles: GroupRole[] = createDefaultRoles();
let groups: GroupConversation[] = [];
const seed = (): GroupConversation[] => [{
  id: ID, name: 'Sweep', ownerId: CREATOR, unreadCount: 0,
  settings: { roles, defaultRoleId: roles[2].id },
  members: [
    { cid: CREATOR, username: 'cid-11', roleId: roles[0].id, joinedAt: 1 },
    { cid: 22n, username: 'bea', roleId: roles[2].id, joinedAt: 1 },
    { cid: SELF, username: 'me', roleId: roles[2].id, joinedAt: 1 },
  ],
}];

bindGroupFailureToasts();
bindGroupRemovalNotice((id: string): string | undefined => groups.find((g) => g.id === id)?.name);
bindGroupProtocolEvents({
  name: (id: string): string | undefined => groups.find((g) => g.id === id)?.name,
  update: (change: (prev: GroupConversation[]) => GroupConversation[]): void => { groups = change(groups); },
});

function arrive(message: Record<string, unknown>): void {
  for (const event of toGroupEvents(message, SELF, 'me', nameOf)) eventEmitter.emit(event.name, event.payload);
}

beforeEach((): void => {
  toasts.length = 0;
  groups = seed();
  vi.spyOn(instanceManager, 'cid', 'get').mockReturnValue(SELF);
});

describe('a refused message', () => {
  it('is toasted with its reason', () => {
    arrive({ GroupMessageRefusedNotification: { cid: SELF, group_key: KEY, refusal: 'NotAMember', request_id: 'r1' } });
    expect(toasts.map((t) => t.description)).toEqual(['You are no longer a member of this group']);
  });
});

describe('a refused end', () => {
  it('tells the owner, and leaves the group in place', () => {
    const events: import('../group-events').GroupEvent[] = toGroupEvents({ GroupEndNotification: { cid: SELF, group_key: KEY, success: false, request_id: 'r2' } }, SELF, 'me', nameOf);
    expect(events).toEqual([{ name: 'group:failed', payload: { operation: 'End', message: '', requestId: 'r2' } }]);
    expect(events.some((e) => e.name === 'group:deleted')).toBe(false);
  });
});

describe('the group passing to a new owner', () => {
  const transfer = (owner: bigint): Record<string, unknown> =>
    ({ GroupOwnershipTransferredNotification: { cid: SELF, group_key: KEY, owner, previous: CREATOR, request_id: null } });

  it("moves the store's owner, and the Owner role, off the key's creator", () => {
    arrive(transfer(22n));
    const [g] = groups;
    expect(g.ownerId).toBe(22n);
    expect(g.members.find((m) => m.cid === 22n)?.roleId).toBe(roles[0].id);
    expect(g.members.find((m) => m.cid === CREATOR)?.roleId).toBe(roles[2].id);
    expect(toasts.map((t) => t.title)).toEqual(['bea now owns Sweep']);
  });

  it('tells the new owner it is theirs', () => {
    arrive(transfer(SELF));
    expect(toasts.map((t) => t.title)).toEqual(['You now own Sweep']);
  });
});

describe('the group resuming on this device', () => {
  const restored = (source: string): Record<string, unknown> => ({ GroupRestoredNotification: { cid: SELF, group_key: KEY, source, request_id: null } });

  it('says whether its history came with it, and nothing when it never left', () => {
    arrive(restored('Backup'));
    arrive(restored('Rejoined'));
    arrive(restored('Refounded'));
    arrive(restored('ThisDevice'));
    expect(toasts.map((t) => t.title)).toEqual([
      'History restored on this device',
      "Earlier history isn't available on this device",
      "Earlier history isn't available on this device",
    ]);
  });
});

describe('the group going', () => {
  const gone = (reason: string): Record<string, unknown> => ({ GroupDisconnectNotification: { cid: SELF, group_key: KEY, reason, request_id: null } });

  it('says which: ended by its owner, or you were removed', () => {
    arrive(gone('ClosedByOwner'));
    arrive(gone('Removed'));
    expect(toasts.map((t) => t.description)).toEqual(['Its owner ended the group.', 'The owner removed you from it.']);
    expect(toasts.every((t) => t.action === undefined)).toBe(true);
  });

  it('offers to start a new group when it ended because its owner left', () => {
    const opened: unknown[] = [];
    eventEmitter.on(START_NEW_GROUP_EVENT, (p: unknown): void => { opened.push(p); });
    arrive(gone('HierarchyOwnerGone'));
    expect(toasts[0].description).toMatch(/^This group ended because its owner left/);
    expect(toasts[0].action?.label).toBe('Start a new group');
    toasts[0].action?.onClick();
    expect(opened).toHaveLength(1);
  });
});
