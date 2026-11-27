/**
 * The workspace server's picture store (PicturePort) for a node's page and a document shared in a
 * node's chat, over the `DocumentPictures` requests. A picture travels in the chunks a channel
 * file does: an upload one chunk at a time, each answered before the next is sent, and a read one
 * chunk at a time. Each answer is taken only when it names this request's document, content id
 * and chunk, and each must arrive within the deadline, or the store is reported offline.
 *
 * The server checks the uploaded bytes against the content id; on read this hands the bytes on
 * unchecked, because the caller (DocumentPictures) checks every read itself. Nothing is cached:
 * the editor holds a picture while its document is open.
 */
import type {
  DocumentPictureRefusal, DocumentPicturesRequest, DocumentPicturesResponse, PictureDocument as WireDocument,
} from 'citadel-workspace-client-ts';
import { CHAT_ATTACHMENT_CHUNK_BYTES } from '@/lib/chat/attachments/attachment-wire';
import { eventEmitter } from '@/lib/event-emitter';
import { DOCUMENT_PICTURES_EVENT } from '@/lib/workspace-response-handler/document-pictures-event';
import type { ProtocolSender } from '@/lib/workspace-service/workspace-operations';
import { workspaceDocumentsTransport } from '../collab/documents-transport';
import type { LinkState } from '../collab/ports';
import { failed, ok, type PictureDocument, type PictureFailure, type PicturePort, type PictureResult } from './picture-port';

/**
 * How long one chunk's answer may take. A chunk is at most 256 KiB, a second or so on a slow
 * link; past this the server is not answering, which is reported as offline.
 */
export const PICTURE_ANSWER_DEADLINE_MS: number = 30_000;

/** Where the requests go, the answers come from, and whether the server can be reached. */
export interface PictureWire {
  /** Resolves once the request has left; its answer arrives through `onAnswer`. */
  send(request: DocumentPicturesRequest): Promise<void>;
  onAnswer(listener: (answer: DocumentPicturesResponse) => void): () => void;
  link(): LinkState;
  onLink(listener: (state: LinkState) => void): () => void;
}

/** What a refusal means to the member. */
export function failureOf(refusal: DocumentPictureRefusal): PictureFailure {
  if (typeof refusal === 'object') {
    if ('TooLarge' in refusal) return { kind: 'tooLarge', maxBytes: Number(refusal.TooLarge.max_bytes) };
    return { kind: 'full', detail: `This document already holds ${refusal.DocumentFull.max_pictures} pictures; remove one to add another.` };
  }
  switch (refusal) {
    case 'Denied': return { kind: 'notPermitted' };
    case 'NotFound': return { kind: 'notFound' };
    case 'StorageFull': return { kind: 'full', detail: "The workspace's storage is full." };
    case 'Mismatch': case 'BadChunk': return { kind: 'damaged' };
    case 'Unavailable': return { kind: 'unavailable', detail: 'The workspace server cannot keep pictures right now.' };
  }
}

/** `doc` as the wire names it; only the server's kinds have one. */
function wireDocument(doc: PictureDocument): WireDocument {
  switch (doc.kind) {
    case 'page': return { node_id: doc.nodeId, chat_doc: null };
    case 'nodeChat': return { node_id: doc.nodeId, chat_doc: doc.chatDoc };
    case 'pair': case 'scratchpad':
      throw new Error(`the workspace server keeps no pictures of a ${doc.kind} document`);
  }
}

type Answer = DocumentPicturesResponse;
type Exchanged = { readonly ok: true; readonly answer: Answer } | { readonly ok: false; readonly failure: PictureFailure };

const OFFLINE: Exchanged = { ok: false, failure: { kind: 'offline' } };

function sameDocument(a: WireDocument, b: WireDocument): boolean {
  return a.node_id === b.node_id && a.chat_doc === b.chat_doc;
}

type ChunkAsked = Pick<Extract<DocumentPicturesRequest, { ReadChunk: unknown }>['ReadChunk'], 'doc' | 'content_id' | 'index'>;
/** What a request asks about: a document's picture chunk, or (no content id) the document's limits. */
type Asked = ChunkAsked | (Pick<ChunkAsked, 'doc'> & { readonly content_id: null; readonly index: null });

function askedBy(request: DocumentPicturesRequest): Asked {
  if ('Limits' in request) return { doc: request.Limits.doc, content_id: null, index: null };
  return 'UploadChunk' in request ? request.UploadChunk : request.ReadChunk;
}

/** Whether `answer` answers `asked`; a refusal names no chunk, so it is matched by document and picture. */
function answers(answer: Answer, asked: Asked): boolean {
  if ('Refused' in answer) return sameDocument(answer.Refused.doc, asked.doc) && answer.Refused.content_id === asked.content_id;
  if ('Limits' in answer) return asked.content_id === null && sameDocument(answer.Limits.doc, asked.doc);
  const body: { doc: WireDocument; content_id: string; index: number } = 'ChunkStored' in answer ? answer.ChunkStored : answer.Chunk;
  return sameDocument(body.doc, asked.doc) && body.content_id === asked.content_id && body.index === asked.index;
}

/** Sends `request` and settles with its answer, its refusal, or offline. */
function exchange(wire: PictureWire, deadlineMs: number, request: DocumentPicturesRequest): Promise<Exchanged> {
  const asked: Asked = askedBy(request);
  if (wire.link() === 'down') return Promise.resolve(OFFLINE);
  return new Promise<Exchanged>((settle: (result: Exchanged) => void): void => {
    const finish = (result: Exchanged): void => { stopAnswers(); stopLink(); clearTimeout(timer); settle(result); };
    const stopAnswers: () => void = wire.onAnswer((answer: Answer): void => {
      if (!answers(answer, asked)) return;
      finish('Refused' in answer ? { ok: false, failure: failureOf(answer.Refused.refusal) } : { ok: true, answer });
    });
    const stopLink: () => void = wire.onLink((state: LinkState): void => { if (state === 'down') finish(OFFLINE); });
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => finish(OFFLINE), deadlineMs);
    wire.send(request).catch((): void => finish(OFFLINE));
  });
}

const UNEXPECTED: PictureFailure = { kind: 'unavailable', detail: 'The workspace server answered with something else.' };

async function put(wire: PictureWire, deadlineMs: number, doc: WireDocument, contentId: string, bytes: Uint8Array): Promise<PictureResult<void>> {
  // One chunk at least: an empty upload is the server's to refuse, not this side's to call stored.
  const total: number = Math.max(1, Math.ceil(bytes.length / CHAT_ATTACHMENT_CHUNK_BYTES));
  for (let index: number = 0; index < total; index++) {
    const part: Uint8Array = bytes.subarray(index * CHAT_ATTACHMENT_CHUNK_BYTES, (index + 1) * CHAT_ATTACHMENT_CHUNK_BYTES);
    const request: DocumentPicturesRequest = {
      UploadChunk: { doc, content_id: contentId, size_bytes: BigInt(bytes.length), index, total_chunks: total, bytes: part.slice() },
    };
    const result: Exchanged = await exchange(wire, deadlineMs, request);
    if (!result.ok) return failed(result.failure);
    if (!('ChunkStored' in result.answer)) return failed(UNEXPECTED);
    if (index + 1 === total && !result.answer.ChunkStored.stored) {
      return failed({ kind: 'unavailable', detail: 'The workspace server took every chunk but did not keep the picture.' });
    }
  }
  return ok(undefined);
}

async function get(wire: PictureWire, deadlineMs: number, doc: WireDocument, contentId: string): Promise<PictureResult<Uint8Array>> {
  const parts: Uint8Array[] = [];
  let total: number = 1;
  for (let index: number = 0; index < total; index++) {
    const result: Exchanged = await exchange(wire, deadlineMs, { ReadChunk: { doc, content_id: contentId, index } });
    if (!result.ok) return failed(result.failure);
    if (!('Chunk' in result.answer)) return failed(UNEXPECTED);
    const chunk: { total_chunks: number; bytes: Uint8Array } = result.answer.Chunk;
    if (index > 0 && chunk.total_chunks !== total) return failed({ kind: 'damaged' });
    total = chunk.total_chunks;
    parts.push(chunk.bytes);
  }
  const whole: Uint8Array = new Uint8Array(parts.reduce((n: number, p: Uint8Array): number => n + p.length, 0));
  parts.reduce((at: number, p: Uint8Array): number => { whole.set(p, at); return at + p.length; }, 0);
  return ok(whole);
}

/** The store over `wire`, each answer awaited at most `deadlineMs`. */
export function serverPictures(wire: PictureWire, deadlineMs: number): PicturePort {
  return {
    put: async (doc: PictureDocument, contentId: string, bytes: Uint8Array): Promise<PictureResult<void>> =>
      put(wire, deadlineMs, wireDocument(doc), contentId, bytes),
    get: async (doc: PictureDocument, contentId: string): Promise<PictureResult<Uint8Array>> =>
      get(wire, deadlineMs, wireDocument(doc), contentId),
    maxBytes: async (doc: PictureDocument): Promise<PictureResult<number>> => {
      const result: Exchanged = await exchange(wire, deadlineMs, { Limits: { doc: wireDocument(doc) } });
      if (!result.ok) return failed(result.failure);
      return 'Limits' in result.answer ? ok(Number(result.answer.Limits.max_bytes)) : failed(UNEXPECTED);
    },
  };
}

/**
 * The production store: this tab's workspace session, through the `sendProtocolRequest` path
 * every workspace request takes, answers off the response handler's `DOCUMENT_PICTURES_EVENT`,
 * and the link state a document's own transport reads (documents-transport.ts), taken from it so
 * the two can never disagree about whether the server is reachable.
 */
export function workspaceServerPictures(sender: ProtocolSender): PicturePort {
  const { link, onLink } = workspaceDocumentsTransport(sender, null);
  return serverPictures({
    send: (request: DocumentPicturesRequest): Promise<void> => sender.sendProtocolRequest({ DocumentPictures: request }, null),
    onAnswer: (listener: (answer: Answer) => void): (() => void) =>
      eventEmitter.on(DOCUMENT_PICTURES_EVENT, (answer: Answer | undefined): void => { if (answer !== undefined) listener(answer); }),
    link,
    onLink,
  }, PICTURE_ANSWER_DEADLINE_MS);
}
