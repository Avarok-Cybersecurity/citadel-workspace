/**
 * Internal HTTP straight to a peer's device, over this account's P2P session through the local
 * agent (p2p-demo-design §1, F1): a frame goes out as `IhttpSend { cid, peer_cid, frame }` and
 * comes in as `IhttpFrameNotification`, whose `peer_cid` is the authenticated session's peer --
 * never anything the app or the frame asserts. The agent checks only shape and the peer's flag,
 * so the authority lives here, at both ends, and is the kernel's (peer-authority.ts):
 *
 *  - calling: `AuthorizePeer(Call)` before the first frame of a stream, a fast fail;
 *  - serving: `AuthorizePeer(Serve{routes_digest})` on each RequestHead, and again on any later
 *    frame once the held answer has expired, so a revocation ends a running stream.
 *
 * Every refusal at either check is the same `Cancel{refused}` to the peer and `{unavailable:
 * "refused"}` to the app: not installed, not consented, blocked and outside the audience cannot
 * be told apart, and a head for an app nobody on this page runs gets that same answer, once
 * (install-plane-registry.ts). Of the install's instances here, only the primary takes heads, and
 * a call goes out under its page id. Frames for a stream this instance neither opened nor
 * admitted are left alone: they are another instance's or another install's.
 */
import type { IhttpPort, InboundIhttpFrame, PortAnswer, Refused } from '../host/ports';
import { decodeCbor, encodeCbor, type Decoded } from '../host/cbor';
import { frame as makeFrame } from '../host/ihttp-common';
import { fromWireFrame, toWireFrame } from '../host/ihttp-wire';
import type { Address } from '../sdk/generated/Address';
import type { Caller } from '../sdk/generated/Caller';
import type { IhttpFrame } from '../sdk/generated/IhttpFrame';
import type { Route } from '../sdk/generated/Route';
import type { IhttpFrom } from 'citadel-workspace-client-ts';
import type { PeerAuthorization } from '../member-consent-types';
import { agentAsk, bytesOf, variantOf, type AgentLink, type AgentOutcome, type Json } from './agent-link';
import { matchRoute, parseRoutes, type ParsedRoutes, type RoutePattern } from '../host/ihttp-routes';
import { routesDigest } from './ihttp-relay-port';
import type { PlaneSeat } from './install-plane-registry';
import type { PeerAuthority } from './peer-authority';

/** The p2p plane's refusals that happened before any frame reached the peer: PreferP2pThenRelay may fall back on these. */
export const P2P_NOT_OPENED: ReadonlySet<string> = new Set<string>(['p2p_no_peer', 'p2p_not_advertised', 'p2p_not_hosted', 'p2p_session', 'refused']);

const SEND_REFUSAL: Readonly<Record<string, Refused>> = {
  NotAdvertised: { unavailable: 'p2p_not_advertised' }, NotHosted: { unavailable: 'p2p_not_hosted' }, Session: { unavailable: 'p2p_session' },
  Malformed: { policy: 'p2p_malformed' }, Queue: { unavailable: 'p2p_queue' },
};
const REFUSED: Refused = { unavailable: 'refused' };

export interface P2pDeps {
  readonly installId: string;
  /** This instance's place among the install's instances on the page. */
  readonly seat: PlaneSeat;
  readonly appId: string;
  /** This tab's session: frames for any other session are not this port's. */
  readonly cid: bigint;
  readonly agent: AgentLink;
  /** The peer's CID from the agent's peer registry; null when there is no P2P relationship. */
  readonly peerCid: (username: string) => bigint | null;
  readonly authority: PeerAuthority;
  readonly sha256Hex: (bytes: Uint8Array) => Promise<string>;
  readonly timeoutMs: number;
  /** The install's consented P2P table (`details.ihttp_p2p_routes`, `METHOD /path` lines), a subset of its relay table. */
  readonly p2pRoutes: readonly string[];
  /** Route limits, as the router parses tables. */
  readonly maxRoutes: number;
  readonly maxPathBytes: number;
  /** This page's own log of why it refused a peer (the peer hears only `refused`). */
  readonly noteRefusal: (peerCid: bigint, side: 'serve' | 'call', why: string) => void;
}

const line = (r: Route): string => `${r.method} ${r.path}`;

/**
 * The P2P plane of one serve(): the app's routes that the install consented for P2P. Null when
 * the app served fewer than were consented, which is not the table the kernel's digest names.
 */
export function p2pTable(served: readonly Route[], consented: readonly string[]): Route[] | null {
  const allowed: ReadonlySet<string> = new Set(consented);
  const table: Route[] = served.filter((r: Route) => allowed.has(line(r)));
  return new Set(table.map(line)).size === allowed.size ? table : null;
}

interface Stream {
  readonly caller: Caller;
  readonly served: boolean;
}

const streamKey = (peerCid: bigint, id: bigint): string => `${peerCid.toString()}#${id.toString()}`;
const callerOf = (p: IhttpFrom): Caller => ({ username: p.username, cid: p.cid, app_id: p.app_id, install_id: p.install_id, via: 'p2p' });
const ended = (f: IhttpFrame): boolean => f.kind === 'End' || (typeof f.kind === 'object' && 'Cancel' in f.kind);

export function p2pIhttpPort(d: P2pDeps): IhttpPort {
  const streams: Map<string, Stream> = new Map<string, Stream>();
  d.seat.hasP2p();
  let digest: string | null = null;
  let table: readonly RoutePattern[] = [];
  /** Inbound frames, one peer at a time and in order, though an authorisation is awaited in between. */
  const chains: Map<bigint, Promise<void>> = new Map<bigint, Promise<void>>();

  /**
   * Outbound frames, one peer at a time and in order: each IhttpSend goes out only once the agent
   * has answered the one before it. The agent handles every request in a task of its own, so two
   * sent together reach the peer's ILM in whichever order the tasks ran; a response's End that
   * overtook its last Body ended the stream with part of the body, and the caller could not read it.
   */
  const sending: Map<bigint, Promise<PortAnswer<null>>> = new Map<bigint, Promise<PortAnswer<null>>>();
  const send = (peerCid: bigint, f: IhttpFrame): Promise<PortAnswer<null>> => {
    const prior: Promise<unknown> = sending.get(peerCid) ?? Promise.resolve();
    const sent: Promise<PortAnswer<null>> = prior.then(() => sendNow(peerCid, f));
    sending.set(peerCid, sent);
    void sent.then((): void => { if (sending.get(peerCid) === sent) sending.delete(peerCid); });
    return sent;
  };
  const sendNow = async (peerCid: bigint, f: IhttpFrame): Promise<PortAnswer<null>> => {
    const bytes: number[] = Array.from(encodeCbor(toWireFrame(f)));
    const out: AgentOutcome<PortAnswer<null>> = await agentAsk<PortAnswer<null>>(d.agent,
      (request_id: string): Json => ({ IhttpSend: { request_id, cid: d.cid, peer_cid: peerCid, frame: bytes } }),
      (message: unknown, id: string): PortAnswer<null> | undefined => {
        if (variantOf(message, 'IhttpSendAccepted')?.request_id === id) return { ok: null };
        const failed: Json | undefined = variantOf(message, 'IhttpSendFailure');
        return failed?.request_id === id ? { refused: SEND_REFUSAL[String(failed.refusal)] ?? { unavailable: 'p2p' } } : undefined;
      }, d.timeoutMs);
    return out.ok ? out.value : { refused: { unavailable: out.why === 'send_failed' ? 'agent' : 'p2p_no_answer' } };
  };
  const refuse = (peerCid: bigint, id: bigint, why: string): void => {
    d.noteRefusal(peerCid, 'serve', why);
    void send(peerCid, makeFrame(id, { Cancel: { reason: 'refused' } }));
  };
  const whyNot = (a: PeerAuthorization | 'limited'): string => (a === 'limited' ? 'limited' : a.ok ? 'ok' : a.why);

  const admitted = async (peerCid: bigint): Promise<PeerAuthorization | 'limited'> =>
    (digest === null ? { ok: false, why: 'not_serving' } : d.authority.authorize(peerCid, { Serve: { routes_digest: digest } }));

  const inbound = async (peerCid: bigint, f: IhttpFrame, deliver: (i: InboundIhttpFrame) => void): Promise<void> => {
    const key: string = streamKey(peerCid, f.stream);
    const kind: IhttpFrame['kind'] = f.kind;
    if (typeof kind === 'object' && 'RequestHead' in kind) {
      if (kind.RequestHead.app_id !== d.appId) {
        if (d.seat.answersForeign(kind.RequestHead.app_id)) refuse(peerCid, f.stream, 'not_running_here');
        return;
      }
      if (!d.seat.primary()) return;
      if (digest === null) { refuse(peerCid, f.stream, 'not_serving'); return; }
      // The router matches the whole served table; a P2P request may reach only the P2P one.
      if (matchRoute(table, kind.RequestHead.method, kind.RequestHead.path) === null) { refuse(peerCid, f.stream, 'route'); return; }
      const a: PeerAuthorization | 'limited' = await admitted(peerCid);
      if (a === 'limited' || !a.ok) { refuse(peerCid, f.stream, whyNot(a)); return; }
      streams.set(key, { caller: callerOf(a.peer), served: true });
      deliver({ from: callerOf(a.peer), frame: f });
      return;
    }
    const s: Stream | undefined = streams.get(key);
    if (s === undefined) return;
    if (s.served) {
      const a: PeerAuthorization | 'limited' = await admitted(peerCid);
      if (a !== 'limited' && !a.ok) {
        streams.delete(key);
        refuse(peerCid, f.stream, whyNot(a));
        deliver({ from: s.caller, frame: makeFrame(f.stream, { Cancel: { reason: 'refused' } }) });
        return;
      }
    }
    if (ended(f) && !(s.served && f.kind === 'End')) streams.delete(key);
    const own: IhttpFrame | null = s.served ? f : d.seat.callIn(s.caller.app_id, f);
    if (own !== null) deliver({ from: s.caller, frame: own });
  };

  return {
    IhttpServe: async ({ routes }: { routes: Route[] }): Promise<PortAnswer<null>> => {
      const mine: Route[] | null = p2pTable(routes, d.p2pRoutes);
      const parsed: ParsedRoutes | null = mine === null ? null : parseRoutes(mine, d.maxRoutes, d.maxPathBytes);
      if (mine === null || parsed === null || !parsed.ok) {
        digest = null;
        table = [];
        return { refused: 'ungranted' };
      }
      table = parsed.routes;
      digest = await routesDigest(mine, d.sha256Hex);
      return { ok: null };
    },
    IhttpCall: async ({ to, frame: asked }: { to: Address; frame: IhttpFrame }): Promise<PortAnswer<null>> => {
      if (!('user' in to)) return { refused: { unavailable: 'p2p_no_peer' } };
      const f: IhttpFrame = d.seat.callOut(to.user.app_id, asked);
      const peerCid: bigint | null = d.peerCid(to.user.username);
      if (peerCid === null) return { refused: { unavailable: 'p2p_no_peer' } };
      const key: string = streamKey(peerCid, f.stream);
      if (typeof f.kind === 'object' && 'RequestHead' in f.kind) {
        const a: PeerAuthorization | 'limited' = await d.authority.authorize(peerCid, 'Call');
        if (a === 'limited' || !a.ok) d.noteRefusal(peerCid, 'call', whyNot(a));
        if (a === 'limited') return { refused: { limit: 'rate' } };
        if (!a.ok) return { refused: REFUSED };
        streams.set(key, { caller: callerOf(a.peer), served: false });
      } else if (!streams.has(key)) return { refused: { policy: 'unknown_stream' } };
      const sent: PortAnswer<null> = await send(peerCid, f);
      if ('refused' in sent || (typeof f.kind === 'object' && 'Cancel' in f.kind)) streams.delete(key);
      return sent;
    },
    respond: (peer: Caller, f: IhttpFrame): Promise<PortAnswer<null>> => {
      if (ended(f)) streams.delete(streamKey(peer.cid, f.stream));
      return send(peer.cid, f);
    },
    onFrame: (listener: (i: InboundIhttpFrame) => void): (() => void) => d.agent.listen((message: unknown): void => {
      const n: Json | undefined = variantOf(message, 'IhttpFrameNotification');
      if (n === undefined || typeof n.peer_cid !== 'bigint' || n.cid !== d.cid) return;
      const raw: Uint8Array | null = bytesOf(n.frame);
      const decoded: Decoded | null = raw === null ? null : decodeCbor(raw);
      const f: IhttpFrame | null = decoded !== null && decoded.ok ? fromWireFrame(decoded.value) : null;
      if (f === null) return;
      const peerCid: bigint = n.peer_cid;
      const next: Promise<void> = (chains.get(peerCid) ?? Promise.resolve()).then(() => inbound(peerCid, f, listener));
      chains.set(peerCid, next.catch((): void => undefined));
    }),
  };
}
