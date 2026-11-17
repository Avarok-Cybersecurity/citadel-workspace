/**
 * A glue app's internal-HTTP calls (R4.4), as the Rust SDK's `ihttp/client.rs` makes them: the
 * request under the server's credit, the response assembled whole, each body chunk reported read
 * so the host grants the server more. A refused frame or the server's Cancel fails the call; who
 * answered is the session's word (`Caller`), never the body's. A call to a member is answered only
 * by that member's instance of the app: a frame on its stream from anyone else is not the call's,
 * so no caller of the client has to check who answered.
 */
import type { Address } from '../sdk/generated/Address';
import type { Caller } from '../sdk/generated/Caller';
import type { FrameKind } from '../sdk/generated/FrameKind';
import type { HttpMethod } from '../sdk/generated/HttpMethod';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { Transport } from '../sdk/generated/Transport';
import type { IhttpIo, IhttpMessage } from './ihttp-io';
import { frame, joined, Outbox } from './ihttp-outbox';

/** The server cancelled the stream: `reason` is its word for why. */
export class IhttpCancelled extends Error {
  constructor(readonly reason: string) {
    super(`the stream was cancelled: ${reason}`);
    this.name = 'IhttpCancelled';
  }
}

export interface IhttpResponse extends IhttpMessage {
  readonly from: Caller;
}

interface Open {
  readonly to: Address;
  readonly transport: Transport;
  readonly outbox: Outbox;
  status: number | null;
  readonly chunks: Uint8Array[];
  readonly resolve: (r: IhttpResponse) => void;
  readonly reject: (e: unknown) => void;
}

const appOf = (to: Address): string => ('user' in to ? to.user.app_id : to.scope.app_id);
const keyOf = (appId: string, stream: bigint): string => `${appId}\n${stream}`;

/** Whether `from` is who `to` names. A scope's server is not a member, so the app is all a scope call can match. */
const answersFor = (to: Address, from: Caller): boolean => ('user' in to ? from.username === to.user.username && from.app_id === to.user.app_id : from.app_id === to.scope.app_id);

export class IhttpClient {
  private last: bigint = 0n;
  private readonly open: Map<string, Open> = new Map();

  constructor(private readonly io: IhttpIo) {}

  /** `query`: the request's query string, without its `?` (empty for none). */
  request(to: Address, transport: Transport, method: HttpMethod, path: string, query: string, body: Uint8Array): Promise<IhttpResponse> {
    this.last += 1n;
    const stream: bigint = this.last;
    const appId: string = appOf(to);
    const head: FrameKind = { RequestHead: { method, path, query, headers: [], body_len: BigInt(body.length), app_id: appId, scope_key: 'scope' in to ? to.scope.scope_key : '' } };
    return new Promise<IhttpResponse>((resolve, reject): void => {
      this.open.set(keyOf(appId, stream), { to, transport, outbox: new Outbox(head, body), status: null, chunks: [], resolve, reject });
      void this.flush(appId, stream);
    });
  }

  /** Whether an inbound frame belongs to one of this client's calls. */
  owns(from: Caller, f: IhttpFrame): boolean {
    return this.callAnsweredBy(from, f) !== undefined;
  }

  private callAnsweredBy(from: Caller, f: IhttpFrame): Open | undefined {
    const o: Open | undefined = this.open.get(keyOf(from.app_id, f.stream));
    return o !== undefined && answersFor(o.to, from) ? o : undefined;
  }

  take(from: Caller, f: IhttpFrame): void {
    const key: string = keyOf(from.app_id, f.stream);
    const o: Open | undefined = this.callAnsweredBy(from, f);
    if (o === undefined) return;
    const kind: FrameKind = f.kind;
    if (kind === 'End') {
      this.open.delete(key);
      if (o.status === null) o.reject(new IhttpCancelled('no_response_head'));
      else o.resolve({ from, status: o.status, body: joined(o.chunks) });
    } else if ('ResponseHead' in kind) o.status = kind.ResponseHead.status;
    else if ('Body' in kind) {
      o.chunks.push(kind.Body.bytes);
      this.io.consumed(from, f.stream).catch((e: unknown): void => this.fail(key, e));
    } else if ('Cancel' in kind) this.fail(key, new IhttpCancelled(kind.Cancel.reason));
    else if ('Credit' in kind) {
      o.outbox.grant(kind.Credit.n);
      void this.flush(from.app_id, f.stream);
    }
  }

  private fail(key: string, e: unknown): void {
    const o: Open | undefined = this.open.get(key);
    if (o === undefined) return;
    this.open.delete(key);
    o.reject(e);
  }

  private async flush(appId: string, stream: bigint): Promise<void> {
    const key: string = keyOf(appId, stream);
    for (;;) {
      const o: Open | undefined = this.open.get(key);
      const next: FrameKind | null = o?.outbox.next() ?? null;
      if (o === undefined || next === null) return;
      try {
        await this.io.call(o.to, frame(stream, next), o.transport);
      } catch (e: unknown) {
        this.fail(key, e);
        return;
      }
    }
  }
}
