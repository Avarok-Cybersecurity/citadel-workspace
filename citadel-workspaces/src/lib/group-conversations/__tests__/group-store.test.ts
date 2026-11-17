/**
 * The property that matters here is SHARING: one list, visible to every
 * consumer. When each hook instance owned its own copy, the sidebar had the
 * group and the group page did not — opening a group bounced straight back to
 * the workspace with "Group not found". These tests pin the store-level rules
 * that fix carried: events apply exactly once no matter how many consumers
 * called start, creates dedup by id, and updates notify subscribers.
 */
import { describe, it, expect } from 'vitest';
import { noSessionUsername } from '@/test-utils/no-session-username';
import { eventEmitter } from '@/lib/event-emitter';
import type { GroupConversation, GroupMember } from '@/types/group-entities';
import {
  getGroups,
  subscribeToGroups,
  startGroupEventBindings,
} from '../group-store';

// Unique ids per test because the store is module-global by design.
let seq: number = 0;
function freshId(): string {
  seq += 1;
  return `7:${Date.now()}${seq}`;
}

function emitCreated(groupId: string): void {
  eventEmitter.emit('group:created', {
    groupId,
    name: 'test group',
    ownerId: '7',
    ownerUsername: 'alice',
  });
}

describe('group store', () => {
  it('applies a created event once and shares it with every reader', () => {
    startGroupEventBindings(noSessionUsername);
    const id: string = freshId();
    let notified: number = 0;
    const unsubscribe: () => void = subscribeToGroups((): void => { notified += 1; });

    emitCreated(id);

    // The same getGroups every consumer uses — no per-instance copy to miss.
    const group: GroupConversation | undefined = getGroups().find(g => g.id === id);
    expect(group).toBeDefined();
    expect(group?.members.map(m => m.username)).toEqual(['alice']);
    expect(notified).toBeGreaterThan(0);
    unsubscribe();
  });

  it('dedups a repeated create for the same id', () => {
    startGroupEventBindings(noSessionUsername);
    const id: string = freshId();

    emitCreated(id);
    emitCreated(id);

    expect(getGroups().filter(g => g.id === id)).toHaveLength(1);
  });

  it('binds events exactly once no matter how many consumers start it', () => {
    // Per-instance handlers over a shared list would apply every event N
    // times; the visible symptom is unread counts climbing by the number of
    // mounted components per message.
    startGroupEventBindings(noSessionUsername);
    startGroupEventBindings(noSessionUsername);
    const id: string = freshId();
    emitCreated(id);

    eventEmitter.emit('group:message-received', {
      groupId: id,
      senderId: '9',
      content: 'hello',
    });

    expect(getGroups().find(g => g.id === id)?.unreadCount).toBe(1);
  });

  it('adds a joined member once, keyed by cid', () => {
    startGroupEventBindings(noSessionUsername);
    const id: string = freshId();
    emitCreated(id);

    const joined: { groupId: string; memberCid: bigint; memberUsername: string; } = { groupId: id, memberCid: 9n, memberUsername: 'bob' };
    eventEmitter.emit('group:member-joined', joined);
    eventEmitter.emit('group:member-joined', joined);

    const members: GroupMember[] = getGroups().find(g => g.id === id)?.members ?? [];
    expect(members.filter(m => m.cid === 9n)).toHaveLength(1);
    expect(members.find(m => m.cid === 9n)?.username).toBe('bob');
  });

  it('gives a joining member a role that exists here, not one from elsewhere', () => {
    startGroupEventBindings(noSessionUsername);
    const id: string = freshId();
    emitCreated(id);

    // Role ids are minted per peer, so an id from another peer's copy of this
    // group names nothing here. Stored as-is it produces a member whose role
    // cannot be found, which the UI can only read as "no permissions".
    eventEmitter.emit('group:member-joined', {
      groupId: id,
      memberCid: 9n,
      memberUsername: 'bob',
      roleId: 'a-role-id-minted-on-another-peer',
    });

    const group: GroupConversation | undefined = getGroups().find(g => g.id === id);
    const bob: GroupMember | undefined = group?.members.find(m => m.cid === 9n);
    expect(bob).toBeDefined();
    expect(bob?.roleId).not.toBe('a-role-id-minted-on-another-peer');
    // The point of the fallback: whatever id they carry must resolve.
    expect(group?.settings.roles.some(r => r.id === bob?.roleId)).toBe(true);
  });

  it('keeps an offered role id that does name a role here', () => {
    // Positive control: the guard must not discard every offered id, only the
    // ones that resolve to nothing.
    startGroupEventBindings(noSessionUsername);
    const id: string = freshId();
    emitCreated(id);
    const real: string = getGroups().find(g => g.id === id)!.settings.roles[0].id;

    eventEmitter.emit('group:member-joined', {
      groupId: id, memberCid: 11n, memberUsername: 'carol', roleId: real,
    });

    expect(getGroups().find(g => g.id === id)?.members.find(m => m.cid === 11n)?.roleId).toBe(real);
  });

  it('removes a member on member-left', () => {
    startGroupEventBindings(noSessionUsername);
    const id: string = freshId();
    emitCreated(id);
    eventEmitter.emit('group:member-joined', { groupId: id, memberCid: 9n, memberUsername: 'bob' });

    eventEmitter.emit('group:member-left', { groupId: id, memberCid: 9n });

    const members: GroupMember[] = getGroups().find(g => g.id === id)?.members ?? [];
    expect(members.some(m => m.cid === 9n)).toBe(false);
  });
});
