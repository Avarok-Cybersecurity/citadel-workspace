/**
 * The peer-group envelope has two ends that must agree.
 *
 * `InternalServiceRequest::GroupMessage` carries an opaque `Vec<u8>`; the
 * protocol does not care what is in it, so nothing but this module keeps the
 * sender and the receiver speaking the same language. The existing tests
 * exercise the two halves separately — the send asserts what goes on the wire,
 * the inbound translator asserts what comes off it — and neither would notice a
 * field added to one side and not the other.
 *
 * `reply_to` is exactly that risk: it was added in round 473, after both halves
 * already existed.
 */
import { describe, it, expect } from 'vitest';
import { encodeGroupMessage, decodeGroupMessage, type PeerGroupMessage } from '../group-message-codec';

const full: PeerGroupMessage = {
  group_id: '7:42',
  message_id: 'm-1',
  sender_cid: 13069842581551822719n,
  content: 'hello',
  timestamp: 1_700_000_000_000,
  reply_to: 'm-0',
};

describe('the peer-group envelope', () => {
  it('round-trips every field', () => {
    expect(decodeGroupMessage(encodeGroupMessage(full))).toEqual(full);
  });

  it('round-trips a cid too large for a number', () => {
    // A CID is a u64. Through JSON this would have silently lost precision;
    // CBOR carries the bigint, which is why the wire format is CBOR here.
    const decoded: PeerGroupMessage | null = decodeGroupMessage(encodeGroupMessage(full));
    expect(decoded?.sender_cid).toBe(13069842581551822719n);
    expect(typeof decoded?.sender_cid).toBe('bigint');
  });

  it('round-trips a message with no reply', () => {
    const noReply: PeerGroupMessage = { ...full, reply_to: undefined };
    const decoded: PeerGroupMessage | null = decodeGroupMessage(encodeGroupMessage(noReply));
    expect(decoded?.reply_to).toBeUndefined();
    expect(decoded?.content).toBe('hello');
  });

  it('round-trips content the protocol has no opinion about', () => {
    // Emoji, newlines and quotes have broken hand-rolled framing before.
    const awkward: PeerGroupMessage = { ...full, content: 'line\n"quoted" 🙂 \\ end' };
    expect(decodeGroupMessage(encodeGroupMessage(awkward))?.content).toBe(awkward.content);
  });

  it('refuses a payload that is not this envelope', () => {
    expect(decodeGroupMessage(new Uint8Array([0xff, 0xff, 0xff]))).toBeNull();
  });

  it('refuses an envelope missing a field the receiver relies on', () => {
    // A peer on an older build. Dropping it beats delivering a message with no
    // id, which handleNewMessage would treat as a new message on every
    // redelivery.
    const { message_id: _omitted, ...withoutId } = full;
    const bytes: Uint8Array = encodeGroupMessage(withoutId as PeerGroupMessage);
    expect(decodeGroupMessage(bytes)).toBeNull();
  });
});
