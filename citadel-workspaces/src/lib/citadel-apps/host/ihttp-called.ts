/**
 * Streams this instance OPENED as a client (IhttpCall). Keyed by (target app id, stream id), as
 * the guest SDK keys them. Outbound: monotonic ids without the relay's bit, head limits, the
 * 4 MiB request body under the server's credit and within its declared length, 64 KiB chunks,
 * 8 live calls (of which at most `limits.p2p.max_fanout_concurrency` may go P2P), nothing after
 * the app's own End. Inbound: one response head, the 16 MiB response body (on P2P, the
 * manifest's `max_response_bytes`) within its declared length and under the credit the app
 * grants back (IhttpConsumed), from the one server that answered. Deadlines as E2, and a call
 * past its deadline always ends for the app, whether or not a server ever answered.
 */
import type { Address } from '../sdk/generated/Address';
import type { Caller } from '../sdk/generated/Caller';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { ResponseHead } from '../sdk/generated/ResponseHead';
import type { Transport } from '../sdk/generated/Transport';
import { abortBoth, allow, cancel, cancelToApp, CLOSED_REASON, deny, frame, headersProblem, MAX_CREDIT, nextDeadline, peerKey, requestHeadProblem, type ClosingAction, type RouterAction, type Verdict } from './ihttp-common';
import type { HostCancelReason } from './ihttp-reasons';
import { RELAY_STREAM_BIT } from './ihttp-wire';
import { responseCap, type IhttpLimits, type P2pCaps } from './limits';

interface Called {
  /** The address the app called, which every frame it sends on the call carries. */
  readonly to: Address;
  /** The transport the RequestHead named; every later frame of the call names it too. */
  readonly transport: Transport;
  readonly appId: string;
  readonly id: bigint;
  readonly opened: number;
  deadline: number;
  /** The server, as the session named it in its first frame back; null until then. */
  server: Caller | null;
  readonly declaredBody: bigint | null;
  requestBytes: number;
  requestEnded: boolean;
  /** Request body frames we may still send. */
  creditOut: number;
  /** Response body frames the server may still send. */
  creditIn: number;
  responseStarted: boolean;
  declaredResponse: bigint | null;
  responseBytes: number;
}

export const addressApp = (to: Address): string => ('user' in to ? to.user.app_id : to.scope.app_id);
const calledKey = (appId: string, id: bigint): string => `${appId}#${id.toString()}`;
const short = (declared: bigint | null, bytes: number): boolean => declared !== null && BigInt(bytes) !== declared;

/**
 * Who the app is told ended a call no server answered. The SDK keys a call by the app it called
 * and the stream id, so those are exact; there is no session to vouch for anyone else, so the
 * rest names nobody (the SDK hands a failed call only its refusal).
 */
const unanswered = (c: Called): Caller => ({
  username: 'user' in c.to ? c.to.user.username : '', cid: 0n, app_id: c.appId, install_id: '', via: c.transport === 'relay' ? 'relay' : 'p2p',
});

export class CalledStreams {
  private readonly streams: Map<string, Called> = new Map<string, Called>();
  private last: bigint = -1n;

  constructor(private readonly limits: IhttpLimits, private readonly p2p: P2pCaps | null) {}

  get size(): number {
    return this.streams.size;
  }

  has(appId: string, id: bigint): boolean {
    return this.streams.has(calledKey(appId, id));
  }

  /** A frame the app sends on a call: `idInUse` says whether a served stream already holds the id. */
  outbound(to: Address, f: IhttpFrame, transport: Transport, now: number, idInUse: boolean): Verdict {
    const appId: string = addressApp(to);
    const kind: IhttpFrame['kind'] = f.kind;
    if (typeof kind === 'object' && 'RequestHead' in kind) {
      if (f.stream <= this.last || (f.stream & RELAY_STREAM_BIT) !== 0n) return deny({ policy: 'stream_id' }, []);
      if (idInUse) return deny({ policy: 'stream_id_in_use' }, []);
      if (kind.RequestHead.app_id !== appId) return deny({ policy: 'wrong_app' }, []);
      if (this.streams.size >= this.limits.maxStreamsPerCaller || this.overP2pCalls(transport)) return deny({ limit: 'calls' }, []);
      const bad: HostCancelReason | null = requestHeadProblem(kind.RequestHead, this.limits);
      if (bad !== null) return deny({ limit: bad }, []);
      this.last = f.stream;
      this.streams.set(calledKey(appId, f.stream), {
        to, transport, appId, id: f.stream, opened: now, deadline: now + this.limits.streamTimeoutMs, server: null,
        declaredBody: kind.RequestHead.body_len, requestBytes: 0, requestEnded: false, responseStarted: false, declaredResponse: null, responseBytes: 0,
        creditOut: this.limits.initialCredit, creditIn: this.limits.initialCredit,
      });
      return allow([]);
    }
    const c: Called | undefined = this.streams.get(calledKey(appId, f.stream));
    if (c === undefined) return deny({ policy: 'unknown_stream' }, []);
    if (c.transport !== transport) return deny({ policy: 'transport' }, []);
    if (typeof kind === 'object' && 'Cancel' in kind) {
      this.streams.delete(calledKey(appId, f.stream));
      return allow([]);
    }
    // The server's credit for our response is minted by the host from IhttpConsumed, never sent by the app.
    if (typeof kind === 'object' && 'Credit' in kind) return deny({ policy: 'credit_is_granted_by_the_host' }, []);
    if (c.requestEnded) return deny({ policy: 'body_after_end' }, []);
    if (kind === 'End') {
      if (short(c.declaredBody, c.requestBytes)) return deny({ policy: 'body_shorter_than_declared' }, []);
      c.requestEnded = true;
      return allow([]);
    }
    if (!('Body' in kind)) return deny({ policy: 'protocol' }, []);
    const bytes: number = kind.Body.bytes.byteLength;
    if (bytes > this.limits.maxChunkBytes) return deny({ limit: 'chunk' }, []);
    if (c.creditOut <= 0) return deny({ limit: 'credit' }, []);
    const total: number = c.requestBytes + bytes;
    if (total > this.limits.maxRequestBodyBytes || (c.declaredBody !== null && BigInt(total) > c.declaredBody)) return deny({ limit: 'request_body' }, []);
    c.requestBytes = total;
    c.creditOut -= 1;
    c.deadline = nextDeadline(c.opened, now, this.limits);
    return allow([]);
  }

  /** A frame from the server on a call this instance made. */
  inbound(peer: Caller, f: IhttpFrame, now: number): RouterAction[] {
    const c: Called = this.streams.get(calledKey(peer.app_id, f.stream)) as Called;
    if (c.server === null) c.server = peer;
    else if (peerKey(c.server) !== peerKey(peer) || c.server.via !== peer.via) return [cancel(peer, f.stream, 'unknown_stream')];
    const kind: IhttpFrame['kind'] = f.kind;
    const deliver: RouterAction[] = [{ kind: 'deliver', peer, frame: f }];
    if (typeof kind === 'object' && 'Cancel' in kind) {
      this.streams.delete(calledKey(c.appId, c.id));
      return deliver;
    }
    if (kind === 'End') {
      if (!c.responseStarted) return this.abort(c, peer, 'protocol');
      if (short(c.declaredResponse, c.responseBytes)) return this.abort(c, peer, 'body_shorter_than_declared');
      this.streams.delete(calledKey(c.appId, c.id));
      return deliver;
    }
    if ('Credit' in kind) {
      if (kind.Credit.n <= 0) return this.abort(c, peer, 'credit');
      c.creditOut = Math.min(MAX_CREDIT, c.creditOut + kind.Credit.n);
      c.deadline = nextDeadline(c.opened, now, this.limits);
      return deliver;
    }
    if ('ResponseHead' in kind) {
      const head: ResponseHead = kind.ResponseHead;
      if (c.responseStarted || headersProblem(head.headers, this.limits) !== null) return this.abort(c, peer, 'protocol');
      if (head.body_len !== null && head.body_len > BigInt(responseCap(this.limits, this.p2p, peer.via))) return this.abort(c, peer, 'response_body_too_large');
      c.responseStarted = true;
      c.declaredResponse = head.body_len;
      return deliver;
    }
    if (!('Body' in kind) || !c.responseStarted) return this.abort(c, peer, 'protocol');
    const bytes: number = kind.Body.bytes.byteLength;
    if (c.creditIn <= 0) return this.abort(c, peer, 'credit');
    if (bytes > this.limits.maxChunkBytes) return this.abort(c, peer, 'chunk_too_large');
    const total: number = c.responseBytes + bytes;
    if (total > responseCap(this.limits, this.p2p, peer.via)) return this.abort(c, peer, 'response_body_too_large');
    if (c.declaredResponse !== null && BigInt(total) > c.declaredResponse) return this.abort(c, peer, 'body_longer_than_declared');
    c.responseBytes = total;
    c.creditIn -= 1;
    c.deadline = nextDeadline(c.opened, now, this.limits);
    return deliver;
  }

  /** The app read one response chunk: one more credit to the server. Null: not a call of ours. */
  consumed(peer: Caller, id: bigint, now: number): RouterAction[] | null {
    const c: Called | undefined = this.streams.get(calledKey(peer.app_id, id));
    if (c === undefined || c.server === null || peerKey(c.server) !== peerKey(peer)) return null;
    c.creditIn = Math.min(MAX_CREDIT, c.creditIn + 1);
    c.deadline = nextDeadline(c.opened, now, this.limits);
    return [{ kind: 'reply', peer, frame: frame(id, { Credit: { n: 1 } }) }];
  }

  /** Every call past its deadline ends, both ways: to its server (as the app addressed it, if none answered yet) and to the app. */
  tick(now: number): RouterAction[] {
    const out: RouterAction[] = [];
    for (const c of [...this.streams.values()]) {
      if (now < c.deadline) continue;
      this.streams.delete(calledKey(c.appId, c.id));
      if (c.server !== null) out.push(...abortBoth(c.server, c.id, 'timeout'));
      else out.push(this.toServer(c, 'timeout'), cancelToApp(unanswered(c), c.id, 'timeout'));
    }
    return out;
  }

  /** The instance is closing: a Cancel on every call it made, and none is open any more. */
  closeAll(): ClosingAction[] {
    const out: ClosingAction[] = [...this.streams.values()].map((c: Called): ClosingAction => this.toServer(c, CLOSED_REASON));
    this.streams.clear();
    return out;
  }

  /** Whether one more call on `transport` would take the calls that may go P2P past `limits.p2p`. */
  private overP2pCalls(transport: Transport): boolean {
    if (transport === 'relay' || this.p2p === null) return false;
    return [...this.streams.values()].filter((c: Called) => c.transport !== 'relay').length >= this.p2p.maxConcurrentCalls;
  }

  private toServer(c: Called, reason: HostCancelReason): Extract<RouterAction, { kind: 'call' }> {
    return { kind: 'call', to: c.to, transport: c.transport, frame: frame(c.id, { Cancel: { reason } }) };
  }

  private abort(c: Called, peer: Caller, reason: HostCancelReason): RouterAction[] {
    this.streams.delete(calledKey(c.appId, c.id));
    return abortBoth(peer, c.id, reason);
  }
}
