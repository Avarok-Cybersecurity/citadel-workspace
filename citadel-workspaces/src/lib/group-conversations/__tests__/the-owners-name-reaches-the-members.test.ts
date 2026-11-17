/**
 * The name a group's creator chose reaches everyone in it.
 *
 * `GroupCreate` and `GroupInvite` carry no name, so the creator's "Team 0924"
 * stayed on the creator's page (group-names.ts said so, honestly) and every
 * invitee saw a default. The one payload the members DO exchange is the
 * peer-group message envelope, which the two ends define themselves -- so the
 * owner's messages now carry the group's name, and a member adopts it.
 *
 * Only the OWNER's. The group key names its owner (`<owner cid>:<mgid>`) and the
 * notification's `peer_cid` is the protocol's statement of who sent it, so a
 * member cannot rename the group for everyone by putting a name in their own
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
    message: Array.from(encodeGroupMessage(body)),
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

describe('reading a name off an arriving message', () => {
  const name = (from: bigint, body: PeerGroupMessage): string | undefined => {
    const summary: PeerGroupMessageSummary | null = peerGroupMessageEvent(notification(from, body), () => 'x');
    return summary?.groupName;
  };

  it("takes the owner's name", () => {
    expect(name(OWNER, envelope({ group_name: 'Team 0924' }))).toBe('Team 0924');
  });

  it("ignores a member's, even one claiming to be the owner in its envelope", () => {
    expect(name(MEMBER, envelope({ sender_cid: OWNER, group_name: 'Pwned' }))).toBeUndefined();
  });

  it('ignores a blank name', () => {
    expect(name(OWNER, envelope({ group_name: '   ' }))).toBeUndefined();
  });
});

describe('applying it', () => {
  const arrival = (groupName?: string): Parameters<typeof applyGroupMessage>[1] => ({
    groupId: GROUP_ID, senderId: OWNER.toString(), content: 'hi', messageId: crypto.randomUUID(), groupName, viewing: false,
  });

  it("renames the member's copy of the group", () => {
    const [after] = applyGroupMessage([group("alice's Group")], arrival('Team 0924'), 1, (cid: bigint): string => cid.toString());
    expect(after.name).toBe('Team 0924');
  });

  it('leaves the name alone when the message carries none', () => {
    const [after] = applyGroupMessage([group("alice's Group")], arrival(), 1, (cid: bigint): string => cid.toString());
    expect(after.name).toBe("alice's Group");
  });
});

describe('what an outgoing message announces', () => {
  it("is the group's name when this session owns the group", () => {
    expect(ownerAnnouncedName(group('Team 0924'), OWNER)).toBe('Team 0924');
  });

  it("is nothing when it does not -- a member's local name is theirs alone", () => {
    expect(ownerAnnouncedName(group('my name for it'), MEMBER)).toBeUndefined();
    expect(ownerAnnouncedName(undefined, OWNER)).toBeUndefined();
  });
});
