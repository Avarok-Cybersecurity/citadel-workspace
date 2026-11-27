/**
 * The name a group's creator chose reaches everyone in it.
 *
 * `GroupCreate` and `GroupInvite` carry no name, so the creator's "Team 0924"
 * stayed on the creator's page (group-names.ts said so, honestly) and every
 * invitee saw a default. The one payload the members DO exchange is the
 * peer-group message envelope, which the two ends define themselves -- so the
 * owner's messages now carry the group's name, and a member adopts it.
 *
 * Only the OWNER's, as the receiver's own record names it (group-owner): the
 * group key names its creator, and the group passes to a member when the owner
 * leaves. The notification's `peer_cid` is the signed sender, so a member
 * cannot rename the group for everyone by putting a name in their own
 * envelope. The envelope's `sender_cid` is the sender's claim and is not used.
 */
import { describe, it, expect } from 'vitest';
import { decodeGroupMessage, encodeGroupMessage, type PeerGroupMessage } from '../group-message-codec';
import { peerGroupMessageEvent, type PeerGroupMessageSummary } from '../peer-group-inbound';
import { applyGroupMessage } from '../apply-group-message';
import { ownerAnnouncedName } from '../group-names';
import type { GroupConversation } from '@/types/group';

const OWNER: bigint = 11n;
const MEMBER: bigint = 22n;
const SELF: bigint = 33n;
const GROUP_ID: string = `${OWNER}:5`;

function envelope(overrides: Partial<PeerGroupMessage> = {}): PeerGroupMessage {
  return { group_id: GROUP_ID, message_id: 'm1', sender_cid: OWNER, content: 'hi', timestamp: 1, ...overrides };
}

function notification(from: bigint, body: PeerGroupMessage): Record<string, unknown> {
  return {
    cid: SELF,
    peer_cid: from,
    message: encodeGroupMessage(body),
    group_key: { cid: OWNER, mgid: 5n },
    request_id: null,
  };
}

function group(name: string, ownerId: bigint = OWNER): GroupConversation {
  return {
    id: GROUP_ID,
    name,
    ownerId,
    members: [],
    settings: { roles: [], defaultRoleId: '' },
    unreadCount: 0,
  };
}

describe('the envelope', () => {
  it('carries a group name across the wire', () => {
    expect(decodeGroupMessage(encodeGroupMessage(envelope({ group_name: 'Team 0924' })))?.group_name).toBe('Team 0924');
  });

  it('decodes an envelope from a build that sends no name', () => {
    expect(decodeGroupMessage(encodeGroupMessage(envelope()))?.group_name).toBeUndefined();
  });
});

describe('a name on an arriving message', () => {
  const arriving = (from: bigint, body: PeerGroupMessage): Parameters<typeof applyGroupMessage>[1] => {
    const summary: PeerGroupMessageSummary | null = peerGroupMessageEvent(notification(from, body), () => 'x');
    if (summary === null) throw new Error('the message did not decode');
    return { groupId: summary.groupId, senderId: summary.senderId, content: summary.content, messageId: crypto.randomUUID(), groupName: summary.groupName, viewing: false };
  };
  const named = (held: GroupConversation, from: bigint, body: PeerGroupMessage): string =>
    applyGroupMessage([held], arriving(from, body), 1, (cid: bigint): string => cid.toString())[0].name;

  it("is adopted from the owner", () => {
    expect(named(group("alice's Group"), OWNER, envelope({ group_name: 'Team 0924' }))).toBe('Team 0924');
  });

  it("is ignored from a member, even one claiming to be the owner in its envelope", () => {
    expect(named(group("alice's Group"), MEMBER, envelope({ sender_cid: OWNER, group_name: 'Pwned' }))).toBe("alice's Group");
  });

  it('is ignored when blank, or absent', () => {
    expect(named(group("alice's Group"), OWNER, envelope({ group_name: '   ' }))).toBe("alice's Group");
    expect(named(group("alice's Group"), OWNER, envelope())).toBe("alice's Group");
  });

  it("follows the group to its new owner: the key's creator no longer renames it", () => {
    const passedOn: GroupConversation = group("alice's Group", MEMBER);
    expect(named(passedOn, MEMBER, envelope({ sender_cid: MEMBER, group_name: 'New hands' }))).toBe('New hands');
    expect(named(passedOn, OWNER, envelope({ group_name: 'Old hands' }))).toBe("alice's Group");
  });
});

describe('what an outgoing message announces', () => {
  it("is the group's name when this session owns the group", () => {
    expect(ownerAnnouncedName(group('Team 0924'), OWNER)).toBe('Team 0924');
  });

  it("is the group's name from its new owner, and nothing from the creator it left", () => {
    expect(ownerAnnouncedName(group('Team 0924', MEMBER), MEMBER)).toBe('Team 0924');
    expect(ownerAnnouncedName(group('Team 0924', MEMBER), OWNER)).toBeUndefined();
  });

  it("is nothing when it does not -- a member's local name is theirs alone", () => {
    expect(ownerAnnouncedName(group('my name for it'), MEMBER)).toBeUndefined();
    expect(ownerAnnouncedName(undefined, OWNER)).toBeUndefined();
  });
});
