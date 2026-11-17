/**
 * Who sent a peer-group message is the protocol's `peer_cid`, never the body's
 * `sender_cid`.
 *
 * The body is written by the sending client. Trusting its `sender_cid` lets any
 * member attribute a message -- or a shared file, whose offer is then matched
 * against the wrong peer's P2P channel -- to anyone, including the reader
 * themselves, which renders it as "You".
 */
import { describe, it, expect } from 'vitest';
import { peerGroupMessageEvent, type PeerGroupMessageSummary } from '../peer-group-inbound';
import { encodeGroupMessage } from '../group-message-codec';
import { encodeGroupFileShare } from '../group-file-codec';

const AUTHOR: bigint = 7n;
const FORGED: bigint = 111n; // the reader's own cid: the most damaging forgery
const peerName = (cid: bigint): string => (cid === AUTHOR ? 'ada' : `cid-${cid.toString()}`);

function notification(body: Uint8Array, peerCid: unknown): Record<string, unknown> {
  return { cid: 111n, peer_cid: peerCid, message: Array.from(body), group_key: { cid: 7n, mgid: 42n }, request_id: 'r1' };
}

const chat: Uint8Array = encodeGroupMessage({
  group_id: '7:42', message_id: 'm-1', sender_cid: FORGED, content: 'hello', timestamp: 1_000,
});
const file: Uint8Array = encodeGroupFileShare({
  group_id: '7:42', message_id: 'f-1', sender_cid: FORGED, timestamp: 1_000,
  file_share: { name: 'report.pdf', size: 10, mime_type: 'application/pdf' },
});

describe('a peer-group sender comes from the transport', () => {
  it('attributes chat to peer_cid when the body names someone else', () => {
    const event: PeerGroupMessageSummary | null = peerGroupMessageEvent(notification(chat, AUTHOR), peerName);
    expect(event?.senderId).toBe('7');
    expect(event?.senderName).toBe('ada');
  });

  it('attributes a shared file, and its offer, to peer_cid when the body names someone else', () => {
    const event: PeerGroupMessageSummary | null = peerGroupMessageEvent(notification(file, AUTHOR), peerName);
    expect(event?.senderId).toBe('7');
    expect(event?.senderName).toBe('ada');
    expect(event?.fileShare?.senderCid).toBe(AUTHOR);
  });

  it('drops a message whose transport names no sender rather than falling back to the body', () => {
    expect(peerGroupMessageEvent(notification(chat, undefined), peerName)).toBeNull();
    expect(peerGroupMessageEvent(notification(file, undefined), peerName)).toBeNull();
  });
});
