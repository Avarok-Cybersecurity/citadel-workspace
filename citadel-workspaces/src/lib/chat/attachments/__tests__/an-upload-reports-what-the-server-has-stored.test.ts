/**
 * An upload's progress is what the server has said it stored, never what has merely been sent: a
 * chunk counts once its ChunkStored answer comes back, so a refused or unanswered chunk never shows
 * as done, and the last report is the whole file.
 */
import { describe, it, expect } from 'vitest';
import type { ChatAttachmentsRequest, ChatAttachmentsResponse } from 'citadel-workspace-client-ts';
import { CHAT_ATTACHMENT_CHUNK_BYTES, sha256Hex, uploadAttachment, type AttachmentWire } from '../attachment-wire';

const NODE: string = 'room-1';
const file: Uint8Array = new Uint8Array(CHAT_ATTACHMENT_CHUNK_BYTES * 2 + 5);

/** A server that answers chunk `refuseAt` with a refusal; `log` interleaves what was sent with what was reported. */
function server(log: string[], refuseAt: number | null): AttachmentWire {
  const listeners: Set<(answer: ChatAttachmentsResponse) => void> = new Set();
  return {
    answerDeadlineMs: 1000,
    onAnswer: (l: (a: ChatAttachmentsResponse) => void): (() => void) => { listeners.add(l); return (): void => { listeners.delete(l); }; },
    send: async (request: ChatAttachmentsRequest): Promise<void> => {
      if (!('UploadChunk' in request)) throw new Error('only uploads here');
      const { sha256, index, total_chunks } = request.UploadChunk;
      log.push(`sent ${index}`);
      const answer: ChatAttachmentsResponse = index === refuseAt
        ? { Refused: { node_id: NODE, attachment_id: sha256, refusal: 'StorageFull' } }
        : { ChunkStored: { node_id: NODE, attachment_id: sha256, index, stored: index + 1 === total_chunks } };
      queueMicrotask((): void => listeners.forEach((l: (a: ChatAttachmentsResponse) => void): void => l(answer)));
    },
  };
}

describe('an upload\'s progress', () => {
  it('counts each chunk once the server says it stored it, ending at the whole file', async () => {
    const log: string[] = [];
    await uploadAttachment(server(log, null), NODE, file, await sha256Hex(file), (stored: number): void => { log.push(`stored ${stored}`); });
    expect(log).toEqual([
      'sent 0', `stored ${CHAT_ATTACHMENT_CHUNK_BYTES}`,
      'sent 1', `stored ${CHAT_ATTACHMENT_CHUNK_BYTES * 2}`,
      'sent 2', `stored ${file.length}`,
    ]);
  });

  it('never counts a chunk the server refused', async () => {
    const log: string[] = [];
    await expect(uploadAttachment(server(log, 1), NODE, file, await sha256Hex(file), (stored: number): void => { log.push(`stored ${stored}`); }))
      .rejects.toThrow("The workspace's storage is full.");
    expect(log).toEqual(['sent 0', `stored ${CHAT_ATTACHMENT_CHUNK_BYTES}`, 'sent 1']);
  });
});
