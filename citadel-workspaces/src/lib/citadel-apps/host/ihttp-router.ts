/**
 * Internal HTTP for one app instance (R4.4), pure over an injected clock: the streams it serves
 * (ihttp-served.ts) and the calls it makes (ihttp-called.ts).
 *
 * Frames carry no direction bit, so stream ids are scoped per (peer, direction): a served stream
 * and a call are separate state and never close, limit or count against each other. And because
 * an inbound Body/End/Cancel/Credit could otherwise name either, the router never lets the two
 * share an id with the same app: a call may not open an id a caller of that app already holds
 * with us, and a caller may not open an id we hold on a call to its app (`stream_id_in_use`).
 * With that, an inbound non-head frame belongs to exactly one direction.
 */
import type { Address } from '../sdk/generated/Address';
import type { Caller } from '../sdk/generated/Caller';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { ServeOn } from '../sdk/generated/ServeOn';
import type { Transport } from '../sdk/generated/Transport';
import { addressApp, CalledStreams } from './ihttp-called';
import { cancel, deny, allow, type ClosingAction, type RouterAction, type Verdict } from './ihttp-common';
import type { RoutePattern } from './ihttp-routes';
import { ServedStreams } from './ihttp-served';
import { RELAY_STREAM_BIT } from './ihttp-wire';
import type { IhttpLimits, P2pCaps } from './limits';

export type { ClosingAction, RouterAction, Verdict };

export class IhttpRouter {
  private readonly served: ServedStreams;
  private readonly called: CalledStreams;

  constructor(appId: string, limits: IhttpLimits, p2p: P2pCaps | null) {
    this.served = new ServedStreams(appId, limits, p2p);
    this.called = new CalledStreams(limits, p2p);
  }

  /** The advertised table and the planes it is served on; an empty one makes every request unrouted. */
  setRoutes(routes: readonly RoutePattern[], on: ServeOn): void {
    this.served.routes = routes;
    this.served.planes = on;
  }

  get liveStreams(): number {
    return this.served.size + this.called.size;
  }

  /** A frame from a peer, as its session vouches for it. */
  inbound(peer: Caller, f: IhttpFrame, now: number): RouterAction[] {
    const kind: IhttpFrame['kind'] = f.kind;
    if (typeof kind === 'object' && 'RequestHead' in kind) {
      // Only the relay allocates ids with its bit set; a P2P caller naming one is not following the protocol.
      if (peer.via === 'p2p' && (f.stream & RELAY_STREAM_BIT) !== 0n) return [cancel(peer, f.stream, 'stream_id')];
      if (this.called.has(peer.app_id, f.stream)) return [cancel(peer, f.stream, 'stream_id_in_use')];
      return this.served.open(peer, f.stream, kind.RequestHead, now);
    }
    if (this.served.has(peer, f.stream)) return this.served.inbound(peer, f, now);
    if (this.called.has(peer.app_id, f.stream)) return this.called.inbound(peer, f, now);
    return [cancel(peer, f.stream, 'unknown_stream')];
  }

  /** IhttpRespond: the app's frame on a stream it serves. */
  respond(peer: Caller, f: IhttpFrame, now: number): Verdict {
    return this.served.respond(peer, f, now);
  }

  /** IhttpCall: the app's frame on a call it makes. */
  call(to: Address, f: IhttpFrame, transport: Transport, now: number): Verdict {
    return this.called.outbound(to, f, transport, now, this.served.usesId(addressApp(to), f.stream));
  }

  /** IhttpConsumed: the app read one body chunk of `stream`; grant its sender one more credit. */
  consumed(peer: Caller, stream: bigint, now: number): Verdict {
    if (this.served.has(peer, stream)) return allow(this.served.consumed(peer, stream, now));
    const credit: RouterAction[] | null = this.called.consumed(peer, stream, now);
    return credit === null ? deny({ policy: 'unknown_stream' }, []) : allow(credit);
  }

  /** The instance is closing: Cancel `closed` on every stream, both ways; nothing is routed after. */
  closeAll(): ClosingAction[] {
    return [...this.served.closeAll(), ...this.called.closeAll()];
  }

  /** Cancels every stream past its deadline, both ways; the app always hears of it. */
  tick(now: number): RouterAction[] {
    return [...this.served.tick(now), ...this.called.tick(now)];
  }
}
