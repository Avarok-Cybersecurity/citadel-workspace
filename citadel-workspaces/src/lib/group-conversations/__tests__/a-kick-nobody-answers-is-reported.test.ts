/**
 * A kick the server never answers must be reported, and the roster must follow
 * whatever the server eventually says.
 *
 * `kickGroupMember` rejected after 30 s with "did not confirm the removal in
 * time" -- but that rejection was not a `group:failed` event, so the failure
 * toast never fired, and neither the page's handler nor the kick dialog caught
 * it. The hook stored it with `setError`, which nothing reads. The dialog
 * closed, the member stayed listed, and the user was told nothing at all.
 *
 * Mocked, as in a-kicked-member-leaves-every-roster.test.ts beside it: the
 * WebSocket send (the wire boundary; tests control what "the server" answers),
 * the connection read (the kicker's CID), and the toast sink (to observe what
 * the user is shown). The group store, event bindings, failure-toast binding
 * and kick logic are all real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';

const h: { sent: Array<Record<string, unknown>>; toasts: Array<{ title: string; description?: string }>; sendFails: boolean } = vi.hoisted(
  (): { sent: Array<Record<string, unknown>>; toasts: Array<{ title: string; description?: string }>; sendFails: boolean } => ({ sent: [], toasts: [], sendFails: false }),
);

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: vi.fn((m: Record<string, unknown>): Promise<void> => {
      if (h.sendFails) return Promise.reject(new Error('Not connected to server'));
      h.sent.push(m);
      return Promise.resolve();
    }),
  },
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: { getConnectionInfo: (): { cid: bigint } => ({ cid: 7n }) },
}));
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn((t: { title: string; description?: string }): void => { h.toasts.push(t); }),
}));

import { eventEmitter } from '@/lib/event-emitter';
import { getGroups, startGroupEventBindings } from '../group-store';
import { kickGroupMember } from '../kick-group-member';
import { toGroupEvents, type GroupEvent } from '../group-events';

let seq: number = 140;
function groupWithBob(): string {
  seq += 1;
  const id: string = `7:${seq}`;
  eventEmitter.emit('group:created', { groupId: id, name: 'Design crew', ownerId: '7', ownerUsername: 'alice' });
  eventEmitter.emit('group:member-joined', { groupId: id, memberCid: 9n, memberUsername: 'bob' });
  return id;
}

function deliver(message: Record<string, unknown>): void {
  for (const e of toGroupEvents(message, 7n, 'alice', (c: bigint): string => c.toString()) as GroupEvent[]) {
    eventEmitter.emit(e.name, e.payload);
  }
}

function members(id: string): bigint[] {
  return getGroups().find(g => g.id === id)?.members.map(m => m.cid) ?? [];
}

function sentKickId(): string {
  return (h.sent.at(-1)?.GroupKick as Record<string, unknown>).request_id as string;
}

beforeEach(() => {
  h.sent = [];
  h.toasts = [];
  h.sendFails = false;
  startGroupEventBindings(noSessionUsername);
  vi.useFakeTimers();
});

afterEach(() => { vi.useRealTimers(); });

describe('a kick the server does not answer', () => {
  it('tells the user, on the group-failure toast, and keeps the member listed', async () => {
    const id: string = groupWithBob();
    const kicking: Promise<void> = kickGroupMember(id, 9n);
    const settled: Promise<unknown> = kicking.catch((e: unknown): unknown => e);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(await settled).toBeInstanceOf(Error);
    expect(h.toasts).toEqual([expect.objectContaining({
      title: 'Could not remove that member',
      description: expect.stringMatching(/did not confirm the removal in time/),
    })]);
    expect(members(id)).toContain(9n);
  });

  it('still takes the member off the roster if the answer arrives late', async () => {
    const id: string = groupWithBob();
    const settled: Promise<unknown> = kickGroupMember(id, 9n).catch((e: unknown): unknown => e);
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;

    deliver({ GroupKickSuccess: { cid: 7n, group_key: { cid: 7n, mgid: BigInt(seq) }, request_id: sentKickId() } });
    await vi.advanceTimersByTimeAsync(0);

    expect(members(id)).toEqual([7n]);
  });

  it('is not reported when the server answers in time', async () => {
    // The control: a kick that toasted unconditionally would pass the first test.
    const id: string = groupWithBob();
    const kicking: Promise<void> = kickGroupMember(id, 9n);
    await vi.advanceTimersByTimeAsync(0);
    deliver({ GroupKickSuccess: { cid: 7n, group_key: { cid: 7n, mgid: BigInt(seq) }, request_id: sentKickId() } });
    await kicking;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(h.toasts).toEqual([]);
    expect(members(id)).toEqual([7n]);
  });
});

describe('a kick that cannot be sent', () => {
  it('tells the user why', async () => {
    h.sendFails = true;
    const id: string = groupWithBob();

    await expect(kickGroupMember(id, 9n)).rejects.toThrow('Not connected to server');
    expect(h.toasts).toEqual([expect.objectContaining({
      title: 'Could not remove that member',
      description: 'Not connected to server',
    })]);
    expect(members(id)).toContain(9n);
  });
});
