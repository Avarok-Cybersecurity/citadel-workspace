/**
 * CdocChatSync on the wire: building the CBOR command a peer receives, and reading what one
 * sent. Everything read here came from the other peer, so every field is checked and every
 * byte string copied into a buffer of its own (a cbor-x view can share the frame's buffer, and
 * the cdoc worker's transfer list needs whole buffers). A payload that is not what this client
 * writes throws ChatWireError; the caller reports it.
 */
import { P2PCommandType, serializeP2PCommand, type P2PCommand } from '@/types/p2p-commands';
import type { CdocChatSync, CdocChatSyncPayload, CdocChatTitleStamp } from '@/types/cdoc-chat-sync';
import { DOC_TITLE_MAX_LENGTH } from '@/lib/live-document-store/doc-title';

export class ChatWireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatWireError';
  }
}

/** A chat document id: what the chat message named it, at most 128 characters, never `#` or `:` (store keys use them). */
export function isChatDocId(docId: string): boolean {
  return docId.length > 0 && docId.length <= 128 && !/[#:\s]/.test(docId);
}

export function chatCommand(payload: CdocChatSyncPayload): P2PCommand {
  return { type: P2PCommandType.CdocChatSync, payload };
}

/** The bytes the P2P channel carries for `payload`. */
export function encodeChatSync(payload: CdocChatSyncPayload): Uint8Array {
  return serializeP2PCommand(chatCommand(payload));
}

const fail = (message: string): never => {
  throw new ChatWireError(message);
};

function bytes(value: unknown, field: string): Uint8Array {
  if (!ArrayBuffer.isView(value)) return fail(`${field} is not a byte string`);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}

function count(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail(`${field} is not a count`);
  return value;
}

export function readTitleStamp(value: unknown): CdocChatTitleStamp {
  if (typeof value !== 'object' || value === null) return fail('the title is not a title stamp');
  const v: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof v.title !== 'string' || v.title.trim() === '' || v.title.length > DOC_TITLE_MAX_LENGTH) return fail('the title is empty or too long');
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return fail('the title has no time');
  if (typeof v.by !== 'bigint' || v.by <= 0n) return fail('the title names no account');
  return { title: v.title, at: v.at, by: v.by };
}

/** Each kind's fields, checked; the envelope was checked by isCdocChatSyncPayload. */
export function readChatSync(payload: CdocChatSyncPayload): CdocChatSync {
  const s: Record<string, unknown> = payload.sync as unknown as Record<string, unknown>;
  switch (payload.sync.kind) {
    case 'hello': {
      if (typeof s.answer !== 'boolean') return fail('hello.answer is not a boolean');
      if (s.migration_origin !== null && typeof s.migration_origin !== 'string') return fail('hello.migration_origin is not a string or null');
      return {
        kind: 'hello',
        state_vector: bytes(s.state_vector, 'hello.state_vector'),
        answer: s.answer,
        migration_origin: s.migration_origin,
        title: s.title === null ? null : readTitleStamp(s.title),
      };
    }
    case 'diff': {
      const index: number = count(s.index, 'diff.index');
      const total: number = count(s.count, 'diff.count');
      if (index >= total) return fail(`diff chunk ${index} of ${total}`);
      return { kind: 'diff', chunk: bytes(s.chunk, 'diff.chunk'), index, count: total };
    }
    case 'update': {
      if (!Array.isArray(s.updates)) return fail('update.updates is not a list');
      return { kind: 'update', updates: s.updates.map((u: unknown): Uint8Array => bytes(u, 'update.updates[]')) };
    }
    case 'awareness':
      return { kind: 'awareness', record: bytes(s.record, 'awareness.record') };
    case 'rename':
      return { kind: 'rename', title: readTitleStamp(s.title) };
  }
}

/** Last writer wins: the later stamp, the higher account on a tie; equal stamps keep `current`. */
export function laterTitle(current: CdocChatTitleStamp | null, incoming: CdocChatTitleStamp): boolean {
  if (current === null) return true;
  if (incoming.at !== current.at) return incoming.at > current.at;
  return incoming.by > current.by;
}
