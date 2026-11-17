/**
 * One group message announces a shared file: name, size, sender. It must
 * round-trip between two new clients, reach the thread through the same
 * translator chat uses, and be IGNORED by a client that predates it -- whose
 * only decoder is `decodeGroupMessage` -- rather than rendered as chat.
 */
import { describe, it, expect } from 'vitest';
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import { encodeGroupFileShare, decodeGroupFileShare, type PeerGroupFileShare } from '../group-file-codec';
import { decodeGroupMessage, encodeGroupMessage } from '../group-message-codec';
import { decodeGroupControl } from '../group-control-codec';
import { peerGroupMessageEvent, type PeerGroupMessageSummary } from '../peer-group-inbound';
import { toGroupEvents } from '../group-events';

const envelope: PeerGroupFileShare = {
  group_id: '7:42',
  message_id: 'f-1',
  sender_cid: 13069842581551822719n,
  timestamp: 1_700_000_000_000,
  file_share: { name: 'report.pdf', size: 123_456, mime_type: 'application/pdf' },
};

function notification(body: Uint8Array, groupKey: { cid: bigint; mgid: bigint } = { cid: 7n, mgid: 42n }): Record<string, unknown> {
  return { cid: 111n, peer_cid: envelope.sender_cid, message: Array.from(body), group_key: groupKey, request_id: 'r1' };
}

describe('the shared-file envelope', () => {
  it('round-trips every field, the u64 sender as a bigint', () => {
    const decoded: PeerGroupFileShare | null = decodeGroupFileShare(encodeGroupFileShare(envelope));
    expect(decoded).toEqual(envelope);
    expect(typeof decoded?.sender_cid).toBe('bigint');
  });

  it('is ignored by the chat decoder every older build has', () => {
    // Older builds lack this build's `file_share` guard; what makes them drop
    // the body is that it carries no `content` string, so that is asserted on
    // the raw bytes, not only through today's decoder.
    const raw: Record<string, unknown> = cborDecode(encodeGroupFileShare(envelope)) as Record<string, unknown>;
    expect('content' in raw, 'an older build would render this as a chat bubble').toBe(false);
    expect(decodeGroupMessage(encodeGroupFileShare(envelope))).toBeNull();
  });

  it('is neither control nor chat, and chat and control are not a file', () => {
    expect(decodeGroupControl(encodeGroupFileShare(envelope))).toBeNull();
    const chat: Uint8Array = encodeGroupMessage({ group_id: '7:42', message_id: 'm', sender_cid: 7n, content: 'hi', timestamp: 1 });
    expect(decodeGroupFileShare(chat)).toBeNull();
    expect(decodeGroupFileShare(cborEncode({ ...envelope, control: { name: 'x' } }))).toBeNull();
  });

  it('refuses a malformed announcement rather than showing a file that is not one', () => {
    for (const bad of [
      { ...envelope, sender_cid: 7 },
      { ...envelope, file_share: { ...envelope.file_share, name: '  ' } },
      { ...envelope, file_share: { ...envelope.file_share, size: -1 } },
      { ...envelope, file_share: { ...envelope.file_share, size: 1.5 } },
      { ...envelope, file_share: undefined },
    ]) {
      expect(decodeGroupFileShare(cborEncode(bad)), JSON.stringify(Object.keys(bad))).toBeNull();
    }
    expect(decodeGroupFileShare(new Uint8Array([0xff, 0x00]))).toBeNull();
  });

  it('arrives as a group message carrying the file, filed by the group key', () => {
    const summary: PeerGroupMessageSummary | null = peerGroupMessageEvent(
      notification(encodeGroupFileShare({ ...envelope, group_id: '9:9' })),
      (): string => 'ada',
    );
    expect(summary?.groupId, 'the key decides the group, never the body').toBe('7:42');
    expect(summary?.messageId).toBe('f-1');
    expect(summary?.senderName).toBe('ada');
    expect(summary?.content).toBe('Shared a file: report.pdf (120.6 KB)');
    expect(summary?.fileShare).toEqual({
      name: 'report.pdf', size: 123_456, mimeType: 'application/pdf', senderCid: envelope.sender_cid,
    });
  });

  it('reaches the group:message-received event the thread and sidebar read', () => {
    const events: ReturnType<typeof toGroupEvents> = toGroupEvents(
      { GroupMessageNotification: notification(encodeGroupFileShare(envelope)) }, 111n, 'me', (): string => 'ada',
    );
    expect(events.map((e): string => e.name)).toEqual(['group:message-received']);
    expect((events[0].payload as { fileShare?: unknown }).fileShare).toBeDefined();
  });
});
