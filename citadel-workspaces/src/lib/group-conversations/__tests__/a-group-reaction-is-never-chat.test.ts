/**
 * A peer-group reaction rides the chat transport and must never be read as
 * chat -- by this build, or by one that predates it.
 *
 * Old builds decode a group body two ways, and the reaction envelope matches
 * neither: `decodeGroupMessage` requires a string `content`, and
 * `decodeGroupControl` requires `control`. The first test pins that on the
 * bytes, so adding either field later fails here rather than in someone's
 * chat as a CBOR map rendered as text.
 */
import { describe, it, expect } from 'vitest';
import { decode as cborDecode } from 'cbor-x';
import { encodeGroupReaction, decodeGroupReaction, type PeerGroupReaction } from '../group-reaction-codec';
import { decodeGroupMessage, encodeGroupMessage } from '../group-message-codec';
import { decodeGroupControl } from '../group-control-codec';
import { toGroupEvents, type GroupEvent } from '../group-events';

const OWNER: bigint = 11n;
const MEMBER: bigint = 22n;
const SELF: bigint = 33n;

function envelope(overrides: Partial<PeerGroupReaction> = {}): PeerGroupReaction {
  return {
    group_id: `${OWNER}:5`,
    message_id: 'r1',
    sender_cid: MEMBER,
    timestamp: 1,
    reaction: { target_id: 'm1', emoji: '👍', active: true, at: 7 },
    ...overrides,
  };
}

function notification(from: bigint, bytes: Uint8Array): Record<string, unknown> {
  return {
    GroupMessageNotification: {
      cid: SELF, peer_cid: from, message: Array.from(bytes), group_key: { cid: OWNER, mgid: 5n }, request_id: null,
    },
  };
}

const events = (n: Record<string, unknown>): GroupEvent[] => toGroupEvents(n, SELF, 'bob', () => 'someone');

describe('what an older client sees', () => {
  it('has neither content nor control, so both pre-reaction decoders reject it', () => {
    const bytes: Uint8Array = encodeGroupReaction(envelope());
    const raw: Record<string, unknown> = cborDecode(bytes) as Record<string, unknown>;
    expect('content' in raw).toBe(false);
    expect('control' in raw).toBe(false);
    expect(decodeGroupMessage(bytes)).toBeNull();
    expect(decodeGroupControl(bytes)).toBeNull();
  });
});

describe('what this client sees', () => {
  it('round-trips the envelope', () => {
    expect(decodeGroupReaction(encodeGroupReaction(envelope()))).toEqual(envelope());
  });

  it('becomes a reaction event and never a chat message', () => {
    expect(events(notification(MEMBER, encodeGroupReaction(envelope()))).map((e) => e.name)).toEqual(['group:reaction-received']);
  });

  it('credits the reactor the protocol names, not the sender_cid in the body', () => {
    const forged: Uint8Array = encodeGroupReaction(envelope({ sender_cid: OWNER }));
    const [event]: GroupEvent[] = events(notification(MEMBER, forged));
    expect(event.payload).toMatchObject({ groupId: `${OWNER}:5`, messageId: 'm1', change: { reactorCid: MEMBER, emoji: '👍', active: true, at: 7 } });
  });

  it('files it under the group key, not the group the body names', () => {
    const [event]: GroupEvent[] = events(notification(MEMBER, encodeGroupReaction(envelope({ group_id: '99:1' }))));
    expect(event.payload.groupId).toBe(`${OWNER}:5`);
  });

  it('is not mistaken for a reaction when it is a chat message', () => {
    const chat: Uint8Array = encodeGroupMessage({ group_id: `${OWNER}:5`, message_id: 'm2', sender_cid: MEMBER, content: 'hi', timestamp: 1 });
    expect(decodeGroupReaction(chat)).toBeNull();
    expect(events(notification(MEMBER, chat)).map((e) => e.name)).toEqual(['group:message-received']);
  });

  it('drops a reaction body with a mistyped field', () => {
    const bad: Uint8Array = encodeGroupReaction({ ...envelope(), reaction: { target_id: 'm1', emoji: '👍', active: 'yes', at: 7 } as never });
    expect(events(notification(MEMBER, bad))).toEqual([]);
  });
});
