/**
 * An in-memory workspace server for the picture store's wire: it keeps uploaded chunks per
 * document and content id, answers each request once (a microtask later, as a socket would), and
 * can be told to refuse, to stay silent, or to drop the link. It does not hash: the kernel's own
 * tests prove the server's checks; this proves what the client does with the answers.
 */
import type { DocumentPictureRefusal, DocumentPicturesRequest, DocumentPicturesResponse, PictureDocument } from 'citadel-workspace-client-ts';
import type { LinkState } from '../../collab/ports';
import type { PictureWire } from '../server-pictures';

export interface ScriptedServer extends PictureWire {
  readonly sent: DocumentPicturesRequest[];
  /** The most requests that were ever sent and not yet answered at once. */
  readonly maxInFlight: () => number;
  setLink(state: LinkState): void;
  /** Answers sent before the real one, as another document's traffic would arrive. */
  decoys: Answer[];
}

type Answer = DocumentPicturesResponse;

export interface Script {
  readonly refuse?: DocumentPictureRefusal;
  /** No answer at all. */
  readonly silent?: boolean;
  /** Flip every byte read back. */
  readonly tamper?: boolean;
  /** The largest picture the server keeps; SHIPPED_MAX_BYTES unless a test is about the limit. */
  readonly maxBytes?: number;
}

/** What the shipped servers keep (`chat_attachment_max_bytes` in docker/workspace-server/kernel.toml and the tenant provisioning). */
export const SHIPPED_MAX_BYTES: number = 25 * 1024 * 1024;
/** The client reads no picture count from Limits (the server refuses past it); any value serves. */
const SCRIPTED_MAX_PICTURES: number = 100;

const keyOf = (doc: PictureDocument, id: string): string => `${doc.node_id}\n${doc.chat_doc ?? ''}\n${id}`;

export function scriptedServer(script: Script = {}): ScriptedServer {
  const listeners: Set<(answer: Answer) => void> = new Set();
  const linkListeners: Set<(state: LinkState) => void> = new Set();
  const kept: Map<string, number[][]> = new Map();
  const sent: DocumentPicturesRequest[] = [];
  let link: LinkState = 'up';
  let inFlight: number = 0;
  let maxInFlight: number = 0;
  const server: ScriptedServer = {
    sent,
    decoys: [],
    maxInFlight: (): number => maxInFlight,
    setLink: (state: LinkState): void => { link = state; linkListeners.forEach((l: (s: LinkState) => void): void => l(state)); },
    link: (): LinkState => link,
    onLink: (l: (s: LinkState) => void): (() => void) => { linkListeners.add(l); return (): void => { linkListeners.delete(l); }; },
    onAnswer: (l: (a: Answer) => void): (() => void) => { listeners.add(l); return (): void => { listeners.delete(l); }; },
    send: async (request: DocumentPicturesRequest): Promise<void> => {
      sent.push(request);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (script.silent === true) return;
      const answer: Answer = answerTo(request);
      const decoys: Answer[] = server.decoys.splice(0);
      queueMicrotask((): void => {
        inFlight -= 1;
        for (const a of [...decoys, answer]) listeners.forEach((l: (x: Answer) => void): void => l(a));
      });
    },
  };
  function answerTo(request: DocumentPicturesRequest): Answer {
    const maxBytes: number = script.maxBytes ?? SHIPPED_MAX_BYTES;
    if ('Limits' in request) {
      const { doc } = request.Limits;
      if (script.refuse !== undefined) return { Refused: { doc, content_id: null, refusal: script.refuse } };
      return { Limits: { doc, max_bytes: BigInt(maxBytes), max_pictures: SCRIPTED_MAX_PICTURES } };
    }
    const body: { doc: PictureDocument; content_id: string } = 'UploadChunk' in request ? request.UploadChunk : request.ReadChunk;
    if (script.refuse !== undefined) return { Refused: { doc: body.doc, content_id: body.content_id, refusal: script.refuse } };
    const key: string = keyOf(body.doc, body.content_id);
    if ('UploadChunk' in request) {
      const { doc, content_id, index, total_chunks, bytes, size_bytes } = request.UploadChunk;
      if (size_bytes > BigInt(maxBytes)) return { Refused: { doc, content_id, refusal: { TooLarge: { max_bytes: BigInt(maxBytes) } } } };
      const parts: number[][] = kept.get(key) ?? [];
      parts[index] = bytes;
      kept.set(key, parts);
      return { ChunkStored: { doc, content_id, index, stored: index + 1 === total_chunks } };
    }
    const { doc, content_id, index } = request.ReadChunk;
    const parts: number[][] | undefined = kept.get(key);
    if (parts === undefined) return { Refused: { doc, content_id, refusal: 'NotFound' } };
    const bytes: number[] = script.tamper === true ? parts[index].map((b: number): number => b ^ 0xff) : parts[index];
    return { Chunk: { doc, content_id, index, total_chunks: parts.length, size_bytes: 0n, bytes } };
  }
  return server;
}
