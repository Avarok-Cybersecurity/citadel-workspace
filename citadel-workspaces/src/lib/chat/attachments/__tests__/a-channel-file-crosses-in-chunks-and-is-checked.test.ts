/**
 * A channel file goes to the server a chunk at a time, each answered before the next, and comes
 * back checked against its id: bytes that are not the shared file are never handed on. A refusal
 * reaches the caller as the server's reason, worded for the person.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatAttachmentRefusal, ChatAttachmentsRequest, ChatAttachmentsResponse } from 'citadel-workspace-client-ts';
import { AttachmentRefused, CHAT_ATTACHMENT_CHUNK_BYTES, readAttachment, sha256Hex, uploadAttachment, type AttachmentWire } from '../attachment-wire';

const NODE: string = 'room-1';
/** Progress is its own test's subject (an-upload-reports-what-the-server-has-stored). */
const IGNORE_PROGRESS = (): void => undefined;

/** A server that keeps what it is sent and answers as the kernel does; `tamper` changes what it reads back. */
function server(options: { refuse?: ChatAttachmentRefusal; tamper?: boolean } = {}): AttachmentWire & { sent: ChatAttachmentsRequest[] } {
  const listeners: Set<(answer: ChatAttachmentsResponse) => void> = new Set();
  const kept: Map<string, number[][]> = new Map();
  const sent: ChatAttachmentsRequest[] = [];
  const answer = (a: ChatAttachmentsResponse): void => { queueMicrotask((): void => listeners.forEach((l: (a: ChatAttachmentsResponse) => void): void => l(a))); };
  return {
    sent,
    answerDeadlineMs: 1000,
    onAnswer: (l: (a: ChatAttachmentsResponse) => void): (() => void) => { listeners.add(l); return (): void => { listeners.delete(l); }; },
    send: async (request: ChatAttachmentsRequest): Promise<void> => {
      sent.push(request);
      if ('UploadChunk' in request) {
        const { sha256, index, total_chunks, bytes } = request.UploadChunk;
        if (options.refuse !== undefined) return answer({ Refused: { node_id: NODE, attachment_id: sha256, refusal: options.refuse } });
        const parts: number[][] = kept.get(sha256) ?? [];
        parts[index] = bytes;
        kept.set(sha256, parts);
        return answer({ ChunkStored: { node_id: NODE, attachment_id: sha256, index, stored: index + 1 === total_chunks } });
      }
      const { attachment_id, index } = request.ReadChunk;
      const parts: number[][] | undefined = kept.get(attachment_id);
      if (parts === undefined) return answer({ Refused: { node_id: NODE, attachment_id, refusal: 'Denied' } });
      const bytes: number[] = options.tamper === true ? parts[index].map((b: number): number => b ^ 1) : parts[index];
      answer({ Chunk: { node_id: NODE, attachment_id, index, total_chunks: parts.length, size_bytes: 0n, bytes } });
    },
  };
}

const file: Uint8Array = Uint8Array.from({ length: CHAT_ATTACHMENT_CHUNK_BYTES * 2 + 5 }, (_: unknown, i: number): number => (i * 7) % 251);

describe('a channel file on the server', () => {
  it('goes up in chunks of the server\'s size and comes back whole', async () => {
    const wire: AttachmentWire & { sent: ChatAttachmentsRequest[]; } = server();
    const id: string = await sha256Hex(file);
    await uploadAttachment(wire, NODE, file, id, IGNORE_PROGRESS);
    const chunks: number[] = wire.sent.map((r: ChatAttachmentsRequest): number => ('UploadChunk' in r ? r.UploadChunk.bytes.length : -1));
    expect(chunks).toEqual([CHAT_ATTACHMENT_CHUNK_BYTES, CHAT_ATTACHMENT_CHUNK_BYTES, 5]);
    expect(await readAttachment(wire, NODE, id)).toEqual(file);
  });

  it('is never handed on when the bytes are not the shared file', async () => {
    const wire: AttachmentWire & { sent: ChatAttachmentsRequest[]; } = server({ tamper: true });
    const id: string = await sha256Hex(file);
    await uploadAttachment(wire, NODE, file, id, IGNORE_PROGRESS);
    await expect(readAttachment(wire, NODE, id)).rejects.toThrow('not the one shared');
  });

  it('says the server\'s reason when it refuses the upload', async () => {
    const wire: AttachmentWire & { sent: ChatAttachmentsRequest[]; } = server({ refuse: 'Denied' });
    const refused: unknown = await uploadAttachment(wire, NODE, file, await sha256Hex(file), IGNORE_PROGRESS).catch((e: unknown): unknown => e);
    expect(refused).toBeInstanceOf(AttachmentRefused);
    expect((refused as AttachmentRefused).message).toBe('You cannot share or open files in this channel.');
    expect(wire.sent).toHaveLength(1);
  });

  it('sends chunks of the size the server cuts them at', () => {
    const rust: string = readFileSync(resolve(__dirname, '../../../../../../citadel-workspace-types/src/apps_protocol.rs'), 'utf8');
    expect(rust).toMatch(/pub const ARTIFACT_CHUNK_BYTES: u32 = 256 \* 1024;/);
    expect(CHAT_ATTACHMENT_CHUNK_BYTES).toBe(256 * 1024);
  });
});
