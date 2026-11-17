/**
 * A member's new browser learns a group from the first message it receives.
 *
 * Live: bob0924 is a server-side member of alice's "Team 0924", but a fresh
 * browser had no record of it -- reconcile-groups only ever REMOVES, from the
 * owned-groups list -- and applyGroupMessage dropped every message for a group
 * the store lacked, so the owner's new message did not make it appear either.
 *
 * A GroupMessageNotification is proof of membership: the server broadcasts
 * only to members. So an unknown (well-formed) group id now creates the record.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let currentCid: bigint | null = 111n;
vi.mock('@/lib/multi-instance/instance-manager', async (importOriginal: () => Promise<typeof import('@/lib/multi-instance/instance-manager')>) => {
  const { instanceManagerWith } = await import('@/test/instance-manager-double');
  const real: typeof import('@/lib/multi-instance/instance-manager') = await importOriginal();
  return { ...real, instanceManager: instanceManagerWith(real.instanceManager, { get cid(): bigint | null { return currentCid; } }) };
});

const { applyGroupMessage } = await import('../apply-group-message');
const { forgetSeenIds } = await import('@/lib/seen-ids');
const { memberUsernamesFor } = await import('../member-group-record');
import type { GroupConversation } from '@/types/group';

const OWNER: bigint = 555n;
const GROUP: string = `${OWNER}:9`;
const usernames: Record<string, string> = { '555': 'alice0924', '777': 'carol0924', '111': 'Peer ZZZZZZ' };
const usernameFor = (cid: bigint): string => usernames[cid.toString()] ?? `Peer ${cid}`;

function message(overrides: Record<string, unknown> = {}): { groupId: string; senderId: string; content: string; messageId?: string; groupName?: string; selfUsername?: string; viewing: boolean } {
  // Not looking at it: the counting rules are the subject here, not the viewing one.
  return { viewing: false, groupId: GROUP, senderId: '555', content: 'hello team', messageId: 'm1', groupName: 'Team 0924', selfUsername: 'bob0924', ...overrides };
}

describe('a message for a group this browser has never seen', () => {
  beforeEach((): void => { currentCid = 111n; forgetSeenIds(); });

  it('creates the group, named as the owner sent it, with one unread', () => {
    const [group]: GroupConversation[] = applyGroupMessage([], message(), 5, usernameFor);
    expect(group.id).toBe(GROUP);
    expect(group.name).toBe('Team 0924');
    expect(group.ownerId).toBe(OWNER);
    expect(group.unreadCount).toBe(1);
    expect(group.lastMessagePreview).toBe('hello team');
    expect(group.members.map((m) => [m.cid, m.username])).toEqual([[555n, 'alice0924'], [111n, 'bob0924']]);
  });

  it('adds a sender who is neither the owner nor this member', () => {
    const [group]: GroupConversation[] = applyGroupMessage([], message({ senderId: '777', groupName: undefined }), 5, usernameFor);
    expect(group.members.map((m) => m.cid)).toEqual([555n, 111n, 777n]);
  });

  it('falls back to the owner-named default when the owner sent no name', () => {
    const [group]: GroupConversation[] = applyGroupMessage([], message({ senderId: '777', groupName: undefined }), 5, usernameFor);
    expect(group.name).toBe("alice0924's Group");
  });

  it('counts a redelivery of that first message once', () => {
    const first: GroupConversation[] = applyGroupMessage([], message(), 5, usernameFor);
    const second: GroupConversation[] = applyGroupMessage(first, message(), 6, usernameFor);
    expect(second).toBe(first);
    expect(second[0].unreadCount).toBe(1);
  });

  it('does not count its own echo as unread', () => {
    const [group]: GroupConversation[] = applyGroupMessage([], message({ senderId: '111' }), 5, usernameFor);
    expect(group.unreadCount).toBe(0);
  });

  it('still ignores an id that is not a group key', () => {
    const before: GroupConversation[] = [];
    expect(applyGroupMessage(before, message({ groupId: 'workspace-room-1' }), 5, usernameFor)).toBe(before);
  });
});

describe('the usernames a message carries for that record', () => {
  it('are the owner\'s and the sender\'s, resolved where the roster is', () => {
    expect(memberUsernamesFor({ groupId: GROUP, senderId: '777' }, usernameFor)).toEqual({ '555': 'alice0924', '777': 'carol0924' });
    expect(memberUsernamesFor({ groupId: 'room-1', senderId: 'x' }, usernameFor)).toEqual({});
  });
});
