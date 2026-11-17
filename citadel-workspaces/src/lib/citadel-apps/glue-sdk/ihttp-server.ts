/**
 * A glue app's internal-HTTP server (R4.4), as the Rust SDK's `ihttp/server.rs` serves: a request
 * assembled from its frames, each body chunk reported read, handed whole to the handler with the
 * caller the session vouches for; the answer sent back under the caller's credit. A handler that
 * throws answers 500, so a stream is never left open.
 */
import type { Caller } from '../sdk/generated/Caller';
import type { FrameKind } from '../sdk/generated/FrameKind';
import type { HttpMethod } from '../sdk/generated/HttpMethod';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { IhttpIo, IhttpMessage } from './ihttp-io';
import { frame, joined, Outbox } from './ihttp-outbox';

export interface IhttpRequest {
  readonly caller: Caller;
  readonly method: HttpMethod;
  readonly path: string;
  /** The query string, without its `?`; empty for none. */
  readonly query: string;
  readonly body: Uint8Array;
}

export type IhttpHandler = (request: IhttpRequest) => Promise<IhttpMessage>;

interface Incoming {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query: string;
  readonly chunks: Uint8Array[];
}

const keyOf = (c: Caller, stream: bigint): string => `${c.username}\n${c.install_id}\n${stream}`;

export class IhttpServer {
  private readonly incoming: Map<string, Incoming> = new Map();
  private readonly outgoing: Map<string, { peer: Caller; outbox: Outbox }> = new Map();

  constructor(private readonly io: IhttpIo, private readonly handler: IhttpHandler) {}

  /** A RequestHead opens a served stream; anything else belongs to one already open, or not here. */
  owns(from: Caller, f: IhttpFrame): boolean {
    const kind: FrameKind = f.kind;
    if (typeof kind === 'object' && 'RequestHead' in kind) return true;
    const key: string = keyOf(from, f.stream);
    return this.incoming.has(key) || this.outgoing.has(key);
  }

  take(from: Caller, f: IhttpFrame): void {
    const key: string = keyOf(from, f.stream);
    const kind: FrameKind = f.kind;
    if (kind === 'End') {
      const inc: Incoming | undefined = this.incoming.get(key);
      this.incoming.delete(key);
      if (inc !== undefined) void this.answer(from, f.stream, { caller: from, method: inc.method, path: inc.path, query: inc.query, body: joined(inc.chunks) });
    } else if ('RequestHead' in kind) this.incoming.set(key, { method: kind.RequestHead.method, path: kind.RequestHead.path, query: kind.RequestHead.query, chunks: [] });
    else if ('Body' in kind) {
      const inc: Incoming | undefined = this.incoming.get(key);
      if (inc === undefined) return;
      inc.chunks.push(kind.Body.bytes);
      this.io.consumed(from, f.stream).catch((e: unknown): void => { console.error('[ihttp] could not report a chunk read', e); });
    } else if ('Cancel' in kind) {
      this.incoming.delete(key);
      this.outgoing.delete(key);
    } else if ('Credit' in kind) {
      this.outgoing.get(key)?.outbox.grant(kind.Credit.n);
      void this.flush(key, f.stream);
    }
  }

  private async answer(peer: Caller, stream: bigint, request: IhttpRequest): Promise<void> {
    let reply: IhttpMessage;
    try {
      reply = await this.handler(request);
    } catch (e: unknown) {
      console.error(`[ihttp] ${request.method} ${request.path} failed`, e);
      reply = { status: 500, body: new Uint8Array() };
    }
    const key: string = keyOf(peer, stream);
    this.outgoing.set(key, { peer, outbox: new Outbox({ ResponseHead: { status: reply.status, headers: [], body_len: BigInt(reply.body.length) } }, reply.body) });
    await this.flush(key, stream);
  }

  private async flush(key: string, stream: bigint): Promise<void> {
    for (;;) {
      const o: { peer: Caller; outbox: Outbox; } | undefined = this.outgoing.get(key);
      const next: FrameKind | null = o?.outbox.next() ?? null;
      if (o === undefined || next === null) {
        if (o?.outbox.done === true) this.outgoing.delete(key);
        return;
      }
      try {
        await this.io.respond(o.peer, frame(stream, next));
      } catch (e: unknown) {
        console.error('[ihttp] a response frame was refused', e);
        this.outgoing.delete(key);
        return;
      }
    }
  }
}
