/**
 * The sending half, and the store binding of the receiving half.
 *
 * A rename, a role edit and a role assignment each reached the local store and
 * nobody else. They now leave as one control envelope over `GroupMessage`.
 *
 * Mocked: the websocket (the I/O boundary; the assertions read the request that
 * would leave the browser), the connection lookup that request needs, and the
 * instance manager's cid (who "I" am). The encode, the choke points, the event
 * binding and the store are production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';

const h: { sent: Array<Record<string, unknown>>; cid: bigint | null } = vi.hoisted(() => ({ sent: [], cid: 11n }));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: { sendMessage: async (r: Record<string, unknown>): Promise<void> => { h.sent.push(r); } },
}));
vi.mock('../../connection', () => ({
  connectionManager: { getConnectionInfo: (): { cid: bigint } => ({ cid: 11n }) },
}));
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return h.cid; } }) };
});

import { eventEmitter } from '@/lib/event-emitter';
import { getGroups, startGroupEventBindings, updateGroups } from '../group-store';
import { applyGroupRename } from '../rename-group';
import { applyGroupSettings } from '../apply-group-settings';
import { assignGroupRole } from '../assign-group-role';
import { decodeGroupControl, type PeerGroupControl } from '../group-control-codec';
import { createDefaultRoles, type GroupConversation, type GroupRole } from '@/types/group';

let seq: number = 0;
function seed(id: string = `11:${7000 + (seq += 1)}`): GroupConversation {
  const roles: GroupRole[] = createDefaultRoles();
  const group: GroupConversation = {
    id, name: 'Old', ownerId: 11n,
    members: [{ cid: 11n, username: 'o', roleId: roles[0].id, joinedAt: 0 }, { cid: 22n, username: 'm', roleId: roles[2].id, joinedAt: 0 }],
    settings: { roles, defaultRoleId: roles[2].id }, unreadCount: 0,
  };
  updateGroups((prev) => [...prev, group]);
  return group;
}

// The send awaits a dynamic import of the connection module, which is more than a microtask.
const flush = async (): Promise<void> => { await new Promise<void>((resolve) => { setTimeout(resolve, 20); }); };

function controlsSent(): PeerGroupControl[] {
  return h.sent
    .filter((r) => 'GroupMessage' in r)
    .map((r) => decodeGroupControl(new Uint8Array((r.GroupMessage as { message: number[] }).message)))
    .filter((c): c is PeerGroupControl => c !== null);
}

let reconciled: boolean = false;

beforeEach(async () => {
  h.cid = 11n;
  startGroupEventBindings(noSessionUsername);
  // The session is live before the bindings start, so binding reconciles it: a
  // GroupListGroupsFor goes out (see reconcile-groups), then GroupListJoined. Wait for the LAST of
  // them rather than a fixed delay: the reconcile first resets the session's groups, and a reset
  // that lands after `seed` wipes the seeded group, so a rename finds nothing to announce -- the
  // first test in this file failed that way in CI once the store's startup grew by a step.
  // The bindings start once per module, so only the first test has that chain to wait for.
  if (!reconciled) {
    await vi.waitFor(() => { expect(h.sent.some((r) => 'GroupListJoined' in r)).toBe(true); });
    reconciled = true;
  }
  await flush();
  h.sent.length = 0;
});

describe('a local change is announced', () => {
  it('a rename sends the new name', async () => {
    const g: GroupConversation = seed();
    applyGroupRename(g.id, 'New');
    await flush();
    expect(controlsSent().map((c) => c.control.name)).toEqual(['New']);
  });

  it('a rename to the same name sends nothing', async () => {
    const g: GroupConversation = seed();
    applyGroupRename(g.id, 'Old');
    await flush();
    expect(controlsSent()).toEqual([]);
  });

  it('a role edit sends the roles', async () => {
    const g: GroupConversation = seed();
    const roles: GroupRole[] = g.settings.roles.map((r) => (r.name === 'Member' ? { ...r, name: 'Guest' } : r));
    applyGroupSettings(g.id, { ...g.settings, roles });
    await flush();
    expect(controlsSent()[0]?.control.settings?.roles.map((r) => r.name)).toContain('Guest');
  });

  it('an assignment sends who holds which role', async () => {
    const g: GroupConversation = seed();
    assignGroupRole(g.id, 22n, g.settings.roles[1].id);
    await flush();
    expect(controlsSent()[0]?.control.assignments).toContainEqual({ cid: 22n, role_id: g.settings.roles[1].id });
  });

  it('a workspace channel is not a peer group and sends nothing', async () => {
    const g: GroupConversation = seed('channel-abc');
    applyGroupRename(g.id, 'New');
    await flush();
    expect(controlsSent()).toEqual([]);
  });
});

describe('the owner speaks when someone joins', () => {
  it('sends its view to the group, including the member who just joined', async () => {
    const g: GroupConversation = seed();
    eventEmitter.emit('group:member-joined', { groupId: g.id, memberCid: 55n, memberUsername: 'new' });
    await flush();
    expect(controlsSent()[0]?.control.assignments?.map((a) => a.cid)).toContain(55n);
  });

  it('a member who does not own the group stays quiet', async () => {
    const g: GroupConversation = seed();
    h.cid = 22n;
    eventEmitter.emit('group:member-joined', { groupId: g.id, memberCid: 55n, memberUsername: 'new' });
    await flush();
    expect(controlsSent()).toEqual([]);
  });
});

describe('an arriving control message', () => {
  it('reaches the store, and is not announced back', async () => {
    const g: GroupConversation = seed();
    h.cid = 22n;
    eventEmitter.emit('group:control-received', { groupId: g.id, senderCid: 11n, ownerCid: 11n, control: { name: 'From owner' } });
    await flush();
    expect(getGroups().find((x) => x.id === g.id)?.name).toBe('From owner');
    expect(controlsSent()).toEqual([]);
  });
});
