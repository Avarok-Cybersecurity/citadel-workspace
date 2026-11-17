/**
 * The group message that announces a shared file.
 *
 * WHY THERE IS NO `content` FIELD -- the same reasoning as group-control-codec.
 * Every build's `decodeGroupMessage` requires `content` to be a string and
 * returns null otherwise, and the inbound path drops a body that does not
 * decode. So a client that predates this envelope IGNORES it rather than
 * rendering a garbled chat bubble. The bytes themselves never travel here: each
 * member gets an ordinary P2P offer (see send-group-file).
 */
import { encode as cborEncode, decode as cborDecode } from 'cbor-x';
import type { GroupFileInfo } from '@/types/group-file-share';

export interface PeerGroupFileShare {
  group_id: string;
  message_id: string;
  /** A CID is a bigint, and CBOR carries one natively. */
  sender_cid: bigint;
  timestamp: number;
  file_share: { name: string; size: number; mime_type: string };
}

export function encodeGroupFileShare(message: PeerGroupFileShare): Uint8Array {
  return cborEncode(message);
}

/** Null for anything that is not a well-formed file announcement, including every chat and control message. */
export function decodeGroupFileShare(bytes: Uint8Array): PeerGroupFileShare | null {
  try {
    const decoded: unknown = cborDecode(bytes);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
    const d: Record<string, unknown> = decoded as Record<string, unknown>;
    if ('control' in d || 'content' in d) return null;
    if (typeof d.group_id !== 'string' || typeof d.message_id !== 'string') return null;
    if (typeof d.sender_cid !== 'bigint') return null;
    const f: unknown = d.file_share;
    if (!f || typeof f !== 'object') return null;
    const file: Record<string, unknown> = f as Record<string, unknown>;
    if (typeof file.name !== 'string' || file.name.trim() === '') return null;
    if (typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0) return null;
    if (typeof file.mime_type !== 'string') return null;
    return {
      group_id: d.group_id,
      message_id: d.message_id,
      sender_cid: d.sender_cid,
      timestamp: typeof d.timestamp === 'number' ? d.timestamp : Date.now(),
      file_share: { name: file.name, size: file.size, mime_type: file.mime_type },
    };
  } catch {
    return null;
  }
}

export function fileInfoOf(envelope: PeerGroupFileShare): GroupFileInfo {
  return { name: envelope.file_share.name, size: envelope.file_share.size, mimeType: envelope.file_share.mime_type };
}
