/**
 * Files shared in a node's chat, over the workspace server's `ChatAttachments` requests: an upload
 * in chunks, each answered before the next goes, and a read in chunks. The id is the SHA-256 of
 * the bytes, which the server checks on upload and this side checks again on read, so a reader
 * holds exactly the bytes the share names.
 *
 * The file is encrypted to the server, as the channel's messages are (owner decision 4), not end
 * to end; the attach control says so (`NODE_FILES_DESTINATION`).
 */
import type { ChatAttachmentRefusal, ChatAttachmentsRequest, ChatAttachmentsResponse } from 'citadel-workspace-client-ts';

/** One chunk's bytes: the server's `CHAT_ATTACHMENT_CHUNK_BYTES` (a drift test reads the Rust). */
export const CHAT_ATTACHMENT_CHUNK_BYTES: number = 256 * 1024;

/** Where the requests go and the answers come from. */
export interface AttachmentWire {
  send(request: ChatAttachmentsRequest): Promise<void>;
  onAnswer(listener: (answer: ChatAttachmentsResponse) => void): () => void;
  /** How long one chunk's answer may take before the transfer fails. */
  readonly answerDeadlineMs: number;
}

export class AttachmentRefused extends Error {
  constructor(readonly refusal: ChatAttachmentRefusal) {
    super(describeRefusal(refusal));
    this.name = 'AttachmentRefused';
  }
}

const MIB: number = 1024 * 1024;

export function describeRefusal(refusal: ChatAttachmentRefusal): string {
  if (typeof refusal === 'object') {
    if ('TooLarge' in refusal) return `Files in this channel can be at most ${Math.floor(Number(refusal.TooLarge.max_bytes) / MIB)} MB.`;
    return `This channel already keeps ${refusal.NodeFull.max_files} files; delete some to share more.`;
  }
  switch (refusal) {
    case 'Denied': return 'You cannot share or open files in this channel.';
    case 'StorageFull': return "The workspace's storage is full.";
    case 'Mismatch': return 'The file changed while it was uploading; try again.';
    case 'BadChunk': return 'The upload was malformed; try again.';
    case 'Unavailable': return 'The workspace server cannot keep files right now.';
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b: number): string => b.toString(16).padStart(2, '0')).join('');
}

type Answer = ChatAttachmentsResponse;

function about(answer: Answer, nodeId: string, id: string): boolean {
  const body: { node_id: string; attachment_id: string } =
    'ChunkStored' in answer ? answer.ChunkStored : 'Chunk' in answer ? answer.Chunk : answer.Refused;
  return body.node_id === nodeId && body.attachment_id === id;
}

/** Sends `request` and resolves with the first answer `wanted` takes, or the refusal about this file. */
function exchange(wire: AttachmentWire, nodeId: string, id: string, request: ChatAttachmentsRequest, wanted: (answer: Answer) => boolean): Promise<Answer> {
  return new Promise<Answer>((resolve: (answer: Answer) => void, reject: (reason: unknown) => void): void => {
    const finish = (settle: () => void): void => { stop(); clearTimeout(timer); settle(); };
    const stop: () => void = wire.onAnswer((answer: Answer): void => {
      if (!about(answer, nodeId, id)) return;
      if ('Refused' in answer) finish((): void => reject(new AttachmentRefused(answer.Refused.refusal)));
      else if (wanted(answer)) finish((): void => resolve(answer));
    });
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      (): void => finish((): void => reject(new Error('The workspace server did not answer, so the file did not transfer.'))),
      wire.answerDeadlineMs,
    );
    wire.send(request).catch((error: unknown): void => finish((): void => reject(error)));
  });
}

/**
 * Uploads `bytes` (whose SHA-256 is `id`) to `nodeId`'s chat, a chunk at a time. `onStored` hears
 * how many bytes the server has said it stored, after each chunk's answer, never on sending one.
 */
export async function uploadAttachment(wire: AttachmentWire, nodeId: string, bytes: Uint8Array, id: string, onStored: (storedBytes: number) => void): Promise<void> {
  const total: number = Math.ceil(bytes.length / CHAT_ATTACHMENT_CHUNK_BYTES);
  for (let index: number = 0; index < total; index++) {
    const part: Uint8Array = bytes.subarray(index * CHAT_ATTACHMENT_CHUNK_BYTES, (index + 1) * CHAT_ATTACHMENT_CHUNK_BYTES);
    const request: ChatAttachmentsRequest = {
      UploadChunk: { node_id: nodeId, sha256: id, size_bytes: BigInt(bytes.length), index, total_chunks: total, bytes: Array.from(part) },
    };
    const answer: Answer = await exchange(wire, nodeId, id, request, (a: Answer): boolean => 'ChunkStored' in a && a.ChunkStored.index === index);
    if (index + 1 === total && !('ChunkStored' in answer && answer.ChunkStored.stored)) {
      throw new Error('The workspace server took every chunk but did not keep the file.');
    }
    onStored(Math.min((index + 1) * CHAT_ATTACHMENT_CHUNK_BYTES, bytes.length));
  }
}

/** Reads the file `id` shared at `nodeId`, checked against its id. */
export async function readAttachment(wire: AttachmentWire, nodeId: string, id: string): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total: number = 1;
  for (let index: number = 0; index < total; index++) {
    const request: ChatAttachmentsRequest = { ReadChunk: { node_id: nodeId, attachment_id: id, index } };
    const answer: Answer = await exchange(wire, nodeId, id, request, (a: Answer): boolean => 'Chunk' in a && a.Chunk.index === index);
    if (!('Chunk' in answer)) throw new Error('The workspace server answered with something else.');
    total = answer.Chunk.total_chunks;
    parts.push(Uint8Array.from(answer.Chunk.bytes));
  }
  const whole: Uint8Array = new Uint8Array(parts.reduce((n: number, p: Uint8Array): number => n + p.length, 0));
  parts.reduce((at: number, p: Uint8Array): number => { whole.set(p, at); return at + p.length; }, 0);
  if ((await sha256Hex(whole)) !== id) throw new Error('The file that arrived is not the one shared, so it was not opened.');
  return whole;
}
