/**
 * The one IhttpPort an instance sees, over the relay and P2P ports (p2p-demo-design §2). Each
 * stream's plane is chosen once, at its RequestHead, from the transport the app named and the
 * planes the install holds (host/ihttp-planes.ts), and the stream stays on it.
 * `prefer_p2p_then_relay` falls back to the relay only when the P2P plane refused the head before
 * any frame reached the peer (P2P_NOT_OPENED), and only when the relay is held; otherwise the app
 * hears `{unavailable: "p2p"}`. A stream never switches plane. Responses go back on the plane the
 * request came by (`peer.via`). Pure over the two injected ports.
 *
 * The SDK sends a call's head, body and End without waiting for any answer, and a plane answers a
 * head only after the kernel or the agent has (AuthorizePeer, IhttpSendAccepted). So the frames
 * behind a head wait for its plane to be decided and then go, in the order sent; refused frames
 * behind a refused head never reach the plane.
 *
 * A head's scope is the host's to name, never the app's: a member's address is served by the
 * install's own scope (the kernel finds the serving install by it; the wire refuses an empty one),
 * and a scope's address by that scope.
 */
import type { Capability } from '../host/capabilities';
import { addressApp } from '../host/ihttp-called';
import { callPlan, type CallPlan, type Plane } from '../host/ihttp-planes';
import type { IhttpPort, InboundIhttpFrame, PortAnswer } from '../host/ports';
import type { Caller } from '../sdk/generated/Caller';
import type { IhttpCall } from '../sdk/generated/IhttpCall';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { IhttpServe } from '../sdk/generated/IhttpServe';
import { P2P_NOT_OPENED } from './ihttp-p2p-port';

export interface TransportPorts {
  readonly relay: IhttpPort;
  /** Null when this tab has no agent session that serves apps: the P2P plane is not here. */
  readonly p2p: IhttpPort | null;
  /** What the install holds for this member (granted, consented, not disabled). */
  readonly held: ReadonlySet<Capability>;
  /** The scope key the install is addressed by (zone-context.ts `scopeKeyOf`). */
  readonly scopeKey: string;
}

const UNAVAILABLE_P2P: PortAnswer<null> = { refused: { unavailable: 'p2p' } };
const key = (appId: string, stream: bigint): string => `${appId}#${stream.toString()}`;
const isCancel = (f: IhttpFrame): boolean => typeof f.kind === 'object' && 'Cancel' in f.kind;
const notOpened = (a: PortAnswer<null>): boolean =>
  'refused' in a && typeof a.refused === 'object' && 'unavailable' in a.refused && P2P_NOT_OPENED.has(a.refused.unavailable);

/** The head as the host sends it: its scope named from the address and the install, not the app. */
function scoped(call: IhttpCall, scopeKey: string): IhttpCall {
  const kind: IhttpFrame['kind'] = call.frame.kind;
  if (typeof kind !== 'object' || !('RequestHead' in kind)) return call;
  const scope: string = 'user' in call.to ? scopeKey : call.to.scope.scope_key;
  return { ...call, frame: { ...call.frame, kind: { RequestHead: { ...kind.RequestHead, scope_key: scope } } } };
}

interface Opened { readonly answer: PortAnswer<null>; readonly plane: Plane | null }

export function transportRouter(t: TransportPorts): IhttpPort {
  /** Each open stream's plane, decided (or being decided) by its head; null: the head was refused. */
  const planes: Map<string, Promise<Plane | null>> = new Map<string, Promise<Plane | null>>();
  const port = (plane: Plane): IhttpPort | null => (plane === 'relay' ? t.relay : t.p2p);

  const open = async (call: IhttpCall, plan: CallPlan): Promise<Opened> => {
    const first: IhttpPort | null = port(plan.first);
    const tried: PortAnswer<null> = first === null ? UNAVAILABLE_P2P : await first.IhttpCall(call);
    if ('ok' in tried) return { answer: tried, plane: plan.first };
    const unopened: boolean = first === null || notOpened(tried);
    if (!unopened) return { answer: tried, plane: null };
    // Asked to prefer P2P with no relay to fall back to: the one answer for "P2P was not possible".
    if (plan.fallback === null) return { answer: call.transport === 'prefer_p2p_then_relay' ? UNAVAILABLE_P2P : tried, plane: null };
    const second: PortAnswer<null> = await t.relay.IhttpCall(call);
    return { answer: second, plane: 'ok' in second ? plan.fallback : null };
  };

  const head = async (call: IhttpCall, plan: CallPlan): Promise<PortAnswer<null>> => {
    const k: string = key(addressApp(call.to), call.frame.stream);
    // Recorded before anything is awaited, so a frame sent right behind the head finds it.
    const opened: Promise<Opened> = open(scoped(call, t.scopeKey), plan);
    const plane: Promise<Plane | null> = opened.then((o: Opened): Plane | null => o.plane);
    planes.set(k, plane);
    const o: Opened = await opened;
    if (o.plane === null && planes.get(k) === plane) planes.delete(k);
    return o.answer;
  };

  const later = async (call: IhttpCall): Promise<PortAnswer<null>> => {
    const k: string = key(addressApp(call.to), call.frame.stream);
    const deciding: Promise<Plane | null> | undefined = planes.get(k);
    const plane: Plane | null = deciding === undefined ? null : await deciding;
    const p: IhttpPort | null = plane === null ? null : port(plane);
    if (p === null) return { refused: { policy: 'unknown_stream' } };
    if (isCancel(call.frame)) planes.delete(k);
    return p.IhttpCall(call);
  };

  return {
    IhttpServe: async (serve: IhttpServe): Promise<PortAnswer<null>> => {
      const answers: PortAnswer<null>[] = [];
      if (serve.on.relay) answers.push(await t.relay.IhttpServe(serve));
      if (serve.on.p2p) answers.push(t.p2p === null ? UNAVAILABLE_P2P : await t.p2p.IhttpServe(serve));
      return answers.find((a: PortAnswer<null>) => 'refused' in a) ?? { ok: null };
    },
    IhttpCall: async (call: IhttpCall): Promise<PortAnswer<null>> => {
      if (typeof call.frame.kind === 'object' && 'RequestHead' in call.frame.kind) {
        const plan: CallPlan | null = callPlan(call.transport, t.held);
        return plan === null ? { refused: 'ungranted' } : head(call, plan);
      }
      return later(call);
    },
    respond: (peer: Caller, f: IhttpFrame): Promise<PortAnswer<null>> | PortAnswer<null> => {
      if (isCancel(f)) planes.delete(key(peer.app_id, f.stream));
      const p: IhttpPort | null = peer.via === 'group' ? null : port(peer.via);
      return p === null ? { refused: { unavailable: peer.via } } : p.respond(peer, f);
    },
    onFrame: (listener: (i: InboundIhttpFrame) => void): (() => void) => {
      const heard = (i: InboundIhttpFrame): void => {
        if (i.frame.kind === 'End' || isCancel(i.frame)) planes.delete(key(i.from.app_id, i.frame.stream));
        listener(i);
      };
      const offRelay: () => void = t.relay.onFrame(heard);
      const offP2p: () => void = t.p2p === null ? (): void => undefined : t.p2p.onFrame(heard);
      return (): void => { offRelay(); offP2p(); };
    },
  };
}
