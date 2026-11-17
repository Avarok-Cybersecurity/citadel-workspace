/**
 * Kicking a member takes them off the kicker's roster, and tells the member.
 *
 * The SDK announces a kick to the removed member (`Disconnected`) and to every
 * remaining member except the kicker (`LeftGroup`). The kicker hears only
 * `GroupKickSuccess`, which names nobody — and nothing acted on it, so the
 * owner kept "Members (2)" with the removed person listed. The removed member's
 * group vanished from the sidebar without a word.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';

const h: { sent: Array<Record<string, unknown>>; toasts: Array<{ title: string }> } = vi.hoisted(
  (): { sent: Array<Record<string, unknown>>; toasts: Array<{ title: string }> } => ({ sent: [], toasts: [] }),
);

vi.mock('@/lib/websocket-service', () => ({
  websocketService: {
    sendMessage: vi.fn((m: Record<string, unknown>): Promise<void> => { h.sent.push(m); return Promise.resolve(); }),
  },
}));
vi.mock('@/lib/connection', () => ({
  connectionManager: { getConnectionInfo: (): { cid: bigint } => ({ cid: 7n }) },
}));
vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn((t: { title: string }): void => { h.toasts.push(t); }),
}));

import { eventEmitter } from '@/lib/event-emitter';
import { getGroups, startGroupEventBindings } from '../group-store';
import { kickGroupMember } from '../kick-group-member';
import { toGroupEvents, type GroupEvent } from '../group-events';

let seq: number = 40;
function groupWithBob(): string {
  seq += 1;
  const id: string = `7:${seq}`;
  eventEmitter.emit('group:created', { groupId: id, name: 'Design crew', ownerId: '7', ownerUsername: 'alice' });
  eventEmitter.emit('group:member-joined', { groupId: id, memberCid: 9n, memberUsername: 'bob' });
  return id;
}

/** Deliver a wire message the way group-response-service does. */
function deliver(message: Record<string, unknown>): void {
  for (const e of toGroupEvents(message, 7n, 'alice', (c: bigint): string => c.toString()) as GroupEvent[]) {
    eventEmitter.emit(e.name, e.payload);
  }
}

function sentKickId(): string {
  const kick: Record<string, unknown> = h.sent.at(-1)?.GroupKick as Record<string, unknown>;
  return kick.request_id as string;
}

const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  h.sent = [];
  h.toasts = [];
  startGroupEventBindings(noSessionUsername);
});

describe('the kicker', () => {
  it('stops listing the member once the server confirms', async () => {
    const id: string = groupWithBob();
    expect(getGroups().find(g => g.id === id)?.members.map(m => m.cid)).toContain(9n);

    const kicking: Promise<void> = kickGroupMember(id, 9n);
    await flush();
    deliver({ GroupKickSuccess: { cid: 7n, group_key: { cid: 7n, mgid: BigInt(seq) }, request_id: sentKickId() } });
    await kicking;

    expect(getGroups().find(g => g.id === id)?.members.map(m => m.cid)).toEqual([7n]);
  });

  it('keeps the member when the server refuses', async () => {
    const id: string = groupWithBob();
    const kicking: Promise<void> = kickGroupMember(id, 9n);
    await flush();
    deliver({ GroupKickFailure: { cid: 7n, message: 'not the owner', request_id: sentKickId() } });

    await expect(kicking).rejects.toThrow('not the owner');
    expect(getGroups().find(g => g.id === id)?.members.map(m => m.cid)).toContain(9n);
  });
});

describe('the removed member', () => {
  it('is told which group they are no longer in', () => {
    const id: string = groupWithBob();
    const [, mgid] = id.split(':');
    deliver({ GroupDisconnectNotification: { cid: 7n, group_key: { cid: 7n, mgid: BigInt(mgid) } } });

    expect(getGroups().some(g => g.id === id)).toBe(false);
    expect(h.toasts.map(t => t.title)).toEqual(["You're no longer in Design crew"]);
  });

  it('is not told anything when they ended the group themselves', () => {
    const id: string = groupWithBob();
    const [, mgid] = id.split(':');
    deliver({ GroupEndNotification: { cid: 7n, group_key: { cid: 7n, mgid: BigInt(mgid) }, success: true } });

    expect(getGroups().some(g => g.id === id)).toBe(false);
    expect(h.toasts).toEqual([]);
  });
});
