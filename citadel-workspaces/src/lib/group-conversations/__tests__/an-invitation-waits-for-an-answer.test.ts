/**
 * An invitation is a question, not a membership.
 *
 * `group:invite-received` used to go straight to applyGroupInvite, which added
 * the group and sent `GroupRespondRequest { response: true }` -- the invitee
 * was a member before they had seen the invitation. The agent does not
 * auto-accept (requests/group/respond_request.rs waits for exactly this
 * request), so the choice was always the UI's to offer.
 *
 * Mocked: the websocket (the I/O boundary -- the assertions are about which
 * request would leave the browser), the connection lookup that request needs
 * for its cid, and the toast renderer. Everything between the event and the
 * request is production code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';

const h: { sent: Array<Record<string, unknown>>; failSend: boolean; toasts: Array<Record<string, unknown>> } = vi.hoisted(() => ({
  sent: [], failSend: false, toasts: [],
}));

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: async (request: Record<string, unknown>): Promise<void> => {
      if (h.failSend) throw new Error('socket closed');
      h.sent.push(request);
    },
  },
}));

vi.mock('@/lib/connection', () => ({
  connectionManager: {
    getConnectionInfo: (): { cid: bigint; username: string } => ({ cid: 33n, username: 'bob' }),
    getTabSelectedSession: async (): Promise<null> => null,
  },
}));

vi.mock('@/hooks/use-toast', () => ({ toast: (t: Record<string, unknown>): void => { h.toasts.push(t); } }));

import { eventEmitter } from '@/lib/event-emitter';
import { getGroups, startGroupEventBindings } from '../group-store';
import { getPendingInvites } from '../group-invites';
import { acceptGroupInvite, declineGroupInvite } from '../respond-to-invite';
import type { GroupInvitePayload } from '@/hooks/use-group-state-invite';

let seq: number = 0;
function invite(): GroupInvitePayload {
  seq += 1;
  return { groupId: `11:${900 + seq}`, groupName: '', inviterId: '11', inviterUsername: 'alice' };
}

function responds(): Array<{ response: boolean; invitation: boolean }> {
  return h.sent
    .filter((r) => 'GroupRespondRequest' in r)
    .map((r) => r.GroupRespondRequest as { response: boolean; invitation: boolean });
}

const flush = async (): Promise<void> => { await new Promise<void>((resolve) => { setTimeout(resolve, 20); }); };

beforeEach(() => {
  h.sent.length = 0;
  h.toasts.length = 0;
  h.failSend = false;
  startGroupEventBindings(noSessionUsername);
});

describe('an arriving invitation', () => {
  it('is held for an answer: no group, no acceptance, and the person is told who asked', async () => {
    const inv: GroupInvitePayload = invite();
    eventEmitter.emit('group:invite-received', inv);
    await flush();

    expect(getPendingInvites().map((p) => p.groupId)).toContain(inv.groupId);
    expect(getGroups().some((g) => g.id === inv.groupId)).toBe(false);
    expect(responds()).toEqual([]);
    expect(h.toasts).toContainEqual(expect.objectContaining({ description: 'alice invited you to a group' }));
  });

  it('is one invitation however many times it is delivered', () => {
    const inv: GroupInvitePayload = invite();
    eventEmitter.emit('group:invite-received', inv);
    eventEmitter.emit('group:invite-received', inv);
    expect(getPendingInvites().filter((p) => p.groupId === inv.groupId)).toHaveLength(1);
  });

  it('is dropped when its group ends before it is answered', () => {
    const inv: GroupInvitePayload = invite();
    eventEmitter.emit('group:invite-received', inv);
    eventEmitter.emit('group:deleted', { groupId: inv.groupId });
    expect(getPendingInvites().some((p) => p.groupId === inv.groupId)).toBe(false);
  });
});

describe('answering it', () => {
  it('accept joins: the group appears and the server is told yes', async () => {
    const inv: GroupInvitePayload = invite();
    eventEmitter.emit('group:invite-received', inv);

    await acceptGroupInvite(inv);

    expect(getGroups().some((g) => g.id === inv.groupId)).toBe(true);
    expect(responds()).toEqual([expect.objectContaining({ response: true, invitation: true })]);
    expect(getPendingInvites().some((p) => p.groupId === inv.groupId)).toBe(false);
  });

  it('decline refuses at the server and leaves no group behind', async () => {
    const inv: GroupInvitePayload = invite();
    eventEmitter.emit('group:invite-received', inv);

    await declineGroupInvite(inv);

    expect(responds()).toEqual([expect.objectContaining({ response: false, invitation: true })]);
    expect(getGroups().some((g) => g.id === inv.groupId)).toBe(false);
    expect(getPendingInvites().some((p) => p.groupId === inv.groupId)).toBe(false);
  });

  it('a decline that could not be sent keeps the invitation and says so', async () => {
    const inv: GroupInvitePayload = invite();
    eventEmitter.emit('group:invite-received', inv);
    h.failSend = true;

    await declineGroupInvite(inv);

    expect(getPendingInvites().some((p) => p.groupId === inv.groupId)).toBe(true);
    expect(h.toasts).toContainEqual(expect.objectContaining({ title: 'Could not decline', variant: 'destructive' }));
  });
});
